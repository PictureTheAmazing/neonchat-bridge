import WebSocket from 'ws';
import pc from 'picocolors';
import { hostname, platform, arch, type as osType, uptime, homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ClaudeCodeExecutor } from './executor.js';
import { getConfig } from './config.js';
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const RECONNECT_DELAY_MS = 5_000; // 5 seconds
const MAX_RECONNECT_DELAY_MS = 60_000; // 1 minute
export class ConnectionManager {
    ws = null;
    executor = null;
    heartbeatTimer = null;
    reconnectTimer = null;
    reconnectDelay = RECONNECT_DELAY_MS;
    currentStatus = 'online';
    currentSessionId = null;
    verbose;
    isShuttingDown = false;
    constructor(verbose = false) {
        this.verbose = verbose;
    }
    /** Connect to the NeonChat backend WebSocket */
    async connect() {
        const config = getConfig();
        if (!config.is_configured) {
            throw new Error('Agent not configured. Run: neonchat-bridge setup --token <token>');
        }
        const wsUrl = config.server_url
            .replace(/^http/, 'ws')
            .replace(/\/$/, '') + '/ws/agent';
        this.log(`Connecting to ${wsUrl}...`);
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'X-Agent-ID': config.agent_id,
                    'X-Device-Token': config.device_token,
                },
            });
            this.ws.on('open', () => {
                this.log(pc.green('✓ Connected to NeonChat'));
                this.reconnectDelay = RECONNECT_DELAY_MS; // Reset backoff
                this.startHeartbeat();
                this.currentStatus = 'online';
                this.sendHeartbeat();
                resolve();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });
            this.ws.on('close', (code, reason) => {
                this.log(pc.yellow(`Disconnected (code: ${code}, reason: ${reason.toString()})`));
                this.stopHeartbeat();
                if (!this.isShuttingDown) {
                    this.scheduleReconnect();
                }
            });
            this.ws.on('error', (err) => {
                this.log(pc.red(`WebSocket error: ${err.message}`));
                // Don't reject on reconnects
                if (!this.ws || this.ws.readyState === WebSocket.CONNECTING) {
                    // First connection attempt
                }
            });
        });
    }
    /** Handle incoming messages from NeonChat backend */
    async handleMessage(raw) {
        let command;
        try {
            command = JSON.parse(raw);
        }
        catch {
            this.log(pc.red('Invalid message received'));
            return;
        }
        this.log(pc.dim(`← Command: ${command.type} [${command.request_id}]`));
        switch (command.type) {
            case 'command':
            case 'resume':
                await this.executeCommand(command);
                break;
            case 'cancel':
                this.cancelExecution(command.request_id);
                break;
            case 'file_browse':
                await this.browseFiles(command);
                break;
            default:
                this.sendResponse({
                    type: 'error',
                    request_id: command.request_id,
                    error: `Unknown command type: ${command.type}`,
                });
        }
    }
    /** Execute a Claude Code command */
    async executeCommand(command) {
        if (this.currentStatus === 'busy') {
            this.sendResponse({
                type: 'error',
                request_id: command.request_id,
                error: 'Agent is busy with another command. Cancel it first or wait.',
            });
            return;
        }
        this.currentStatus = 'busy';
        this.executor = new ClaudeCodeExecutor();
        const config = getConfig();
        // Stream messages back to the UI
        this.executor.on('message', (msg) => {
            // Extract text content for display
            // stream-json format: assistant messages have text at msg.message.content[].text
            // while top-level msg.content may also exist for some message types
            const messageContent = msg.message;
            const contentArray = messageContent?.content || msg.content;
            const textContent = contentArray
                ?.filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('') || '';
            const role = messageContent?.role || msg.role || msg.type || 'system';
            this.sendResponse({
                type: 'stream',
                request_id: command.request_id,
                session_id: this.executor?.getSessionId(),
                message: {
                    role: role,
                    content: textContent,
                    metadata: {
                        raw_type: msg.type,
                        subtype: msg.subtype,
                        tools: msg.tools,
                    },
                },
            });
        });
        // Handle final result
        this.executor.on('result', (result) => {
            this.currentSessionId = result.session_id;
            this.sendResponse({
                type: 'result',
                request_id: command.request_id,
                session_id: result.session_id,
                cost_usd: result.cost_usd,
                duration_ms: result.duration_ms,
                num_turns: result.num_turns,
                message: {
                    role: 'assistant',
                    content: result.result,
                },
            });
            this.currentStatus = 'online';
        });
        // Handle errors
        this.executor.on('error', (err) => {
            this.sendResponse({
                type: 'error',
                request_id: command.request_id,
                error: err.message,
            });
            this.currentStatus = 'online';
        });
        // Handle process exit (in case result never fires)
        this.executor.on('exit', (code, stderr) => {
            if (this.currentStatus === 'busy') {
                // Process exited while still busy - probably an error
                let errorMsg = `Claude Code process exited with code ${code}`;
                if (stderr && stderr.trim() && !stderr.startsWith('(failed')) {
                    errorMsg += `\n\nError output:\n${stderr}`;
                }
                else if (code !== 0) {
                    errorMsg += ' (no error output captured)';
                }
                this.sendResponse({
                    type: 'error',
                    request_id: command.request_id,
                    error: errorMsg,
                });
                this.currentStatus = 'online';
            }
        });
        // Start execution
        try {
            await this.executor.execute({
                prompt: command.prompt,
                working_directory: command.working_directory || config.default_working_dir,
                session_id: command.type === 'resume' ? command.session_id : undefined,
                allowed_tools: command.allowed_tools || config.allowed_tools,
            });
        }
        catch (err) {
            this.sendResponse({
                type: 'error',
                request_id: command.request_id,
                error: err instanceof Error ? err.message : 'Unknown execution error',
            });
            this.currentStatus = 'online';
        }
    }
    /** Cancel the current execution */
    cancelExecution(requestId) {
        if (this.executor) {
            this.executor.cancel();
            this.currentStatus = 'online';
            this.sendResponse({
                type: 'result',
                request_id: requestId,
                message: {
                    role: 'system',
                    content: 'Command cancelled by user',
                },
            });
        }
    }
    /** Browse files on this machine (read-only directory listing) */
    browseFiles(command) {
        const config = getConfig();
        const requestedPath = command.path || command.working_directory || config.default_working_dir || homedir();
        const targetPath = resolve(requestedPath);
        const result = {
            type: 'file_browse_result',
            request_id: command.request_id,
            path: targetPath,
            entries: [],
        };
        try {
            const items = readdirSync(targetPath, { withFileTypes: true });
            result.entries = items
                .filter((item) => !item.name.startsWith('.') || item.name === '..')
                .map((item) => {
                const fullPath = join(targetPath, item.name);
                const isDir = item.isDirectory();
                return { name: item.name, path: fullPath, isDirectory: isDir };
            })
                .sort((a, b) => {
                // Directories first, then files
                if (a.isDirectory !== b.isDirectory)
                    return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            // Add parent directory entry if not at root
            const parent = resolve(targetPath, '..');
            if (parent !== targetPath) {
                result.entries.unshift({ name: '..', path: parent, isDirectory: true });
            }
        }
        catch (err) {
            result.error = err instanceof Error ? err.message : 'Failed to read directory';
        }
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(result));
        }
    }
    /** Send a response back to NeonChat */
    sendResponse(response) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(response));
            if (this.verbose) {
                this.log(pc.dim(`→ ${response.type} [${response.request_id}]`));
            }
        }
    }
    /** Send a heartbeat with current system info */
    sendHeartbeat() {
        if (this.ws?.readyState !== WebSocket.OPEN)
            return;
        const config = getConfig();
        let claudeVersion = 'unknown';
        try {
            claudeVersion = execSync('claude --version', { encoding: 'utf8', timeout: 3000 }).trim();
        }
        catch { /* ignore */ }
        const heartbeat = {
            type: 'heartbeat',
            agent_id: config.agent_id,
            status: this.currentStatus,
            system_info: {
                hostname: hostname(),
                os: osType(),
                platform: platform(),
                arch: arch(),
                claude_code_version: claudeVersion,
                uptime_seconds: Math.floor(uptime()),
                memory_usage_mb: Math.round((process.memoryUsage().rss / 1024 / 1024)),
                node_version: process.version,
                default_working_dir: config.default_working_dir,
            },
            current_session: this.currentSessionId || undefined,
            timestamp: new Date().toISOString(),
        };
        this.ws.send(JSON.stringify(heartbeat));
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    /** Reconnect with exponential backoff */
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        this.log(pc.dim(`Reconnecting in ${this.reconnectDelay / 1000}s...`));
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                await this.connect();
            }
            catch {
                // Increase backoff
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
                this.scheduleReconnect();
            }
        }, this.reconnectDelay);
    }
    /** Gracefully disconnect */
    async disconnect() {
        this.isShuttingDown = true;
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.executor) {
            this.executor.cancel();
        }
        if (this.ws) {
            this.ws.close(1000, 'Agent shutting down');
        }
    }
    log(msg) {
        const time = new Date().toLocaleTimeString();
        console.log(`${pc.dim(time)} ${msg}`);
    }
}
//# sourceMappingURL=connection.js.map