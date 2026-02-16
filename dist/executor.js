import { spawn, execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync, statSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export class ClaudeCodeExecutor extends EventEmitter {
    process = null;
    sessionId = '';
    buffer = '';
    constructor() {
        super();
    }
    /**
     * Execute a Claude Code command and stream the results.
     * Uses `claude -p` with `--output-format stream-json`.
     * Stdout is redirected to a temp file and polled, because Claude Code's
     * native binary doesn't write to Node.js socket-pair stdio on ARM64.
     */
    async execute(options) {
        // Pre-flight check: verify claude command exists and works
        const isWindows = process.platform === 'win32';
        const checkCmd = isWindows ? 'where claude' : 'which claude';
        try {
            execSync(checkCmd, { stdio: 'pipe' });
        }
        catch (err) {
            throw new Error('Claude CLI not found in PATH. Please install it from https://claude.ai/download ' +
                'and ensure the "claude" command is available. ' +
                (isWindows ? 'You may need to restart your terminal after installation.' : ''));
        }
        // Try to run claude --version to verify it actually works
        try {
            const versionOutput = execSync('claude --version', { encoding: 'utf8', stdio: 'pipe' });
            console.log('[Bridge] Claude CLI version:', versionOutput.trim());
        }
        catch (versionErr) {
            throw new Error(`Claude CLI exists but failed to run: ${versionErr.message}\n` +
                'This might indicate a corrupted installation or permission issue. ' +
                'Try reinstalling from https://claude.ai/download');
        }
        const args = [
            '-p', options.prompt,
            '--output-format', 'stream-json',
            '--verbose',
            '--dangerously-skip-permissions',
        ];
        // Resume existing session
        if (options.session_id) {
            args.push('--resume', options.session_id);
        }
        // Set allowed tools
        if (options.allowed_tools && options.allowed_tools.length > 0) {
            args.push('--allowedTools', options.allowed_tools.join(','));
        }
        // Load MCP config
        if (options.mcp_config_path) {
            args.push('--mcp-config', options.mcp_config_path);
        }
        // Append to system prompt
        if (options.system_prompt_append) {
            args.push('--append-system-prompt', options.system_prompt_append);
        }
        const cwd = options.working_directory || process.cwd();
        return new Promise((resolve, reject) => {
            const env = { ...process.env };
            delete env.CLAUDECODE; // Allow spawning from within a Claude Code session
            // File-based stdout/stderr to work around native binary stdio issues
            const ts = Date.now();
            const outFile = join(tmpdir(), `claude-bridge-${ts}.jsonl`);
            const errFile = join(tmpdir(), `claude-bridge-${ts}.err`);
            // Open file descriptors for output redirection
            const outFd = openSync(outFile, 'w');
            const errFd = openSync(errFile, 'w');
            // Spawn claude directly without shell (avoids quoting issues on Windows)
            this.process = spawn('claude', args, {
                cwd,
                env,
                stdio: ['ignore', outFd, errFd],
                detached: false,
            });
            this.buffer = '';
            let fileOffset = 0;
            let lastOutputTime = Date.now();
            let noOutputWarned = false;
            // Poll the output file for new data
            const pollInterval = setInterval(() => {
                try {
                    const stat = statSync(outFile);
                    if (stat.size > fileOffset) {
                        const fd = openSync(outFile, 'r');
                        const buf = Buffer.alloc(stat.size - fileOffset);
                        readSync(fd, buf, 0, buf.length, fileOffset);
                        closeSync(fd);
                        fileOffset = stat.size;
                        this.buffer += buf.toString();
                        this.processBuffer();
                        lastOutputTime = Date.now();
                        noOutputWarned = false;
                    }
                    else {
                        // Check if no output for too long
                        const noOutputDuration = Date.now() - lastOutputTime;
                        if (noOutputDuration > 30000 && !noOutputWarned) {
                            noOutputWarned = true;
                            this.emit('message', {
                                type: 'assistant_message',
                                message: {
                                    role: 'assistant',
                                    content: [{
                                            type: 'text',
                                            text: 'Claude Code is still running but hasn\'t produced output in 30 seconds. This might indicate an issue. Check the bridge logs or try canceling and restarting.',
                                        }],
                                },
                            });
                        }
                    }
                }
                catch {
                    // File might not exist yet
                }
            }, 200);
            const cleanup = () => {
                clearInterval(pollInterval);
                // Close file descriptors
                try {
                    closeSync(outFd);
                }
                catch { /* ignore */ }
                try {
                    closeSync(errFd);
                }
                catch { /* ignore */ }
                // Clean up temp files
                try {
                    unlinkSync(outFile);
                }
                catch { /* ignore */ }
                try {
                    unlinkSync(errFile);
                }
                catch { /* ignore */ }
            };
            this.process.on('error', (err) => {
                cleanup();
                this.emit('error', err);
                reject(err);
            });
            this.process.on('close', (code) => {
                clearInterval(pollInterval);
                // Read any remaining data before cleanup
                try {
                    const stat = statSync(outFile);
                    if (stat.size > fileOffset) {
                        const fd = openSync(outFile, 'r');
                        const buf = Buffer.alloc(stat.size - fileOffset);
                        readSync(fd, buf, 0, buf.length, fileOffset);
                        closeSync(fd);
                        this.buffer += buf.toString();
                    }
                }
                catch { /* ignore */ }
                this.processBuffer();
                // Read stderr and stdout BEFORE cleanup to pass to exit handler
                let stderrContent = '';
                let stdoutContent = '';
                if (code !== 0) {
                    try {
                        stderrContent = readFileSync(errFile, 'utf8');
                    }
                    catch (readErr) {
                        stderrContent = `(failed to read stderr: ${readErr})`;
                    }
                    // Also check stdout in case errors went there
                    try {
                        const fullStdout = readFileSync(outFile, 'utf8');
                        // If there's unparsed output in stdout, include it
                        if (fullStdout && !fullStdout.trim().startsWith('{')) {
                            stdoutContent = fullStdout;
                        }
                    }
                    catch { /* ignore */ }
                }
                // Combine stderr and stdout for diagnostics
                const diagnostics = [stderrContent, stdoutContent].filter(s => s.trim()).join('\n---\n');
                // Clean up temp files
                try {
                    unlinkSync(outFile);
                }
                catch { /* ignore */ }
                try {
                    unlinkSync(errFile);
                }
                catch { /* ignore */ }
                // Emit exit with diagnostic content
                this.emit('exit', code, diagnostics || undefined);
                resolve();
            });
            // Set timeout
            if (options.timeout_ms) {
                setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.process.kill('SIGTERM');
                        this.emit('error', new Error(`Execution timed out after ${options.timeout_ms}ms`));
                    }
                }, options.timeout_ms);
            }
        });
    }
    /**
     * Process the buffer, parsing complete JSON lines.
     * Claude Code's stream-json outputs one JSON object per line.
     */
    processBuffer() {
        const lines = this.buffer.split('\n');
        // Keep the last incomplete line in the buffer
        this.buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const msg = JSON.parse(trimmed);
                // Capture session ID from init message
                if (msg.type === 'init' || msg.session_id) {
                    this.sessionId = msg.session_id || this.sessionId;
                }
                this.emit('message', msg);
                // If this is the final result, emit that separately
                if (msg.type === 'result') {
                    this.emit('result', {
                        session_id: this.sessionId,
                        result: msg.result || '',
                        cost_usd: msg.total_cost_usd || 0,
                        duration_ms: msg.duration_ms || 0,
                        num_turns: msg.num_turns || 0,
                        is_error: msg.is_error || false,
                    });
                }
            }
            catch {
                // Not valid JSON — might be a partial line or plain text output
            }
        }
    }
    /** Cancel the currently running command */
    cancel() {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
        }
    }
    /** Get the current session ID (available after first message) */
    getSessionId() {
        return this.sessionId;
    }
}
//# sourceMappingURL=executor.js.map