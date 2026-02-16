import WebSocket from 'ws';
import pc from 'picocolors';
import { hostname, platform, arch, type as osType, uptime, freemem } from 'node:os';
import { execSync } from 'node:child_process';
import { ClaudeCodeExecutor, type ClaudeStreamMessage, type ClaudeResult } from './executor.js';
import { getConfig } from './config.js';
import type { AgentCommand, AgentHeartbeat, AgentResponse, AgentStatus, SystemInfo } from './types.js';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const RECONNECT_DELAY_MS = 5_000;     // 5 seconds
const MAX_RECONNECT_DELAY_MS = 60_000; // 1 minute

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private executor: ClaudeCodeExecutor | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_DELAY_MS;
  private currentStatus: AgentStatus = 'online';
  private currentSessionId: string | null = null;
  private verbose: boolean;
  private isShuttingDown = false;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  /** Connect to the NeonChat backend WebSocket */
  async connect(): Promise<void> {
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
  private async handleMessage(raw: string): Promise<void> {
    let command: AgentCommand;
    try {
      command = JSON.parse(raw);
    } catch {
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
  private async executeCommand(command: AgentCommand): Promise<void> {
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
    this.executor.on('message', (msg: ClaudeStreamMessage) => {
      // Extract text content for display
      // stream-json format: assistant messages have text at msg.message.content[].text
      // while top-level msg.content may also exist for some message types
      const messageContent = (msg as unknown as Record<string, unknown>).message as { content?: Array<{ type: string; text?: string }>; role?: string } | undefined;
      const contentArray = messageContent?.content || msg.content;
      const textContent = contentArray
        ?.filter((c: { type: string; text?: string }) => c.type === 'text')
        .map((c: { type: string; text?: string }) => c.text)
        .join('') || '';

      const role = messageContent?.role || msg.role || msg.type || 'system';

      this.sendResponse({
        type: 'stream',
        request_id: command.request_id,
        session_id: this.executor?.getSessionId(),
        message: {
          role: role as AgentResponse['message'] extends { role: infer R } ? R : never,
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
    this.executor.on('result', (result: ClaudeResult) => {
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
    this.executor.on('error', (err: Error) => {
      this.sendResponse({
        type: 'error',
        request_id: command.request_id,
        error: err.message,
      });
      this.currentStatus = 'online';
    });

    // Handle process exit (in case result never fires)
    this.executor.on('exit', (code: number | null) => {
      if (this.currentStatus === 'busy') {
        // Process exited while still busy - probably an error
        this.sendResponse({
          type: 'error',
          request_id: command.request_id,
          error: `Claude Code process exited unexpectedly with code ${code}`,
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
    } catch (err) {
      this.sendResponse({
        type: 'error',
        request_id: command.request_id,
        error: err instanceof Error ? err.message : 'Unknown execution error',
      });
      this.currentStatus = 'online';
    }
  }

  /** Cancel the current execution */
  private cancelExecution(requestId: string): void {
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

  /** Browse files on this machine (read-only) */
  private async browseFiles(command: AgentCommand): Promise<void> {
    // Use a quick Claude Code call to list directory contents
    const executor = new ClaudeCodeExecutor();
    await executor.execute({
      prompt: command.prompt, // e.g., "List the files in /home/user/projects"
      allowed_tools: ['Read', 'Glob', 'Grep'], // Read-only tools
      working_directory: command.working_directory,
      timeout_ms: 15_000,
    });
  }

  /** Send a response back to NeonChat */
  private sendResponse(response: AgentResponse): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(response));
      if (this.verbose) {
        this.log(pc.dim(`→ ${response.type} [${response.request_id}]`));
      }
    }
  }

  /** Send a heartbeat with current system info */
  private sendHeartbeat(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    const config = getConfig();
    let claudeVersion = 'unknown';
    try {
      claudeVersion = execSync('claude --version', { encoding: 'utf8', timeout: 3000 }).trim();
    } catch { /* ignore */ }

    const heartbeat: AgentHeartbeat = {
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
      },
      current_session: this.currentSessionId || undefined,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(heartbeat));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Reconnect with exponential backoff */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.log(pc.dim(`Reconnecting in ${this.reconnectDelay / 1000}s...`));

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        // Increase backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  /** Gracefully disconnect */
  async disconnect(): Promise<void> {
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

  private log(msg: string): void {
    const time = new Date().toLocaleTimeString();
    console.log(`${pc.dim(time)} ${msg}`);
  }
}
