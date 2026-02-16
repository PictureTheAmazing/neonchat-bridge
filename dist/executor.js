import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
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
            delete env.CLAUDECODE; // Allow spawning Claude Code from within a Claude Code session
            this.process = spawn('claude', args, {
                cwd,
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            this.buffer = '';
            this.process.stdout?.on('data', (chunk) => {
                this.buffer += chunk.toString();
                this.processBuffer();
            });
            this.process.stderr?.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (text) {
                    this.emit('message', {
                        type: 'system',
                        content: [{ type: 'text', text }],
                    });
                }
            });
            this.process.on('error', (err) => {
                this.emit('error', err);
                reject(err);
            });
            this.process.on('close', (code) => {
                this.processBuffer();
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
                // Just skip it
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