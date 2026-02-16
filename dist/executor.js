import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { statSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
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
            const outFile = `/tmp/claude-bridge-${ts}.jsonl`;
            const errFile = `/tmp/claude-bridge-${ts}.err`;
            const cmd = ['claude', ...args].map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
            this.process = spawn('sh', ['-c', `${cmd} > '${outFile}' 2> '${errFile}'`], {
                cwd,
                env,
                stdio: 'ignore',
                detached: false,
            });
            this.buffer = '';
            let fileOffset = 0;
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
                    }
                }
                catch {
                    // File might not exist yet
                }
            }, 200);
            const cleanup = () => {
                clearInterval(pollInterval);
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
                // Clean up temp files
                try {
                    unlinkSync(outFile);
                }
                catch { /* ignore */ }
                try {
                    unlinkSync(errFile);
                }
                catch { /* ignore */ }
                this.emit('exit', code);
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