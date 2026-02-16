import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import type { AgentMessage } from './types.js';

function debugLog(msg: string) {
  appendFileSync('/tmp/bridge-debug.log', `${new Date().toISOString()} ${msg}\n`);
}

/** Events emitted by the executor */
export interface ExecutorEvents {
  /** A streamed message from Claude Code */
  message: (msg: ClaudeStreamMessage) => void;
  /** The final result */
  result: (result: ClaudeResult) => void;
  /** An error occurred */
  error: (error: Error) => void;
  /** Process exited */
  exit: (code: number | null) => void;
}

/** A single message from Claude Code's stream-json output */
export interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    name?: string;
    input?: unknown;
    content?: unknown;
  }>;
  session_id?: string;
  // init message fields
  tools?: string[];
  mcp_servers?: string[];
  // result message fields
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  result?: string;
  is_error?: boolean;
}

export interface ClaudeResult {
  session_id: string;
  result: string;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  is_error: boolean;
}

export interface ExecuteOptions {
  prompt: string;
  working_directory?: string;
  session_id?: string; // for resuming
  allowed_tools?: string[];
  mcp_config_path?: string;
  system_prompt_append?: string;
  timeout_ms?: number;
}

export class ClaudeCodeExecutor extends EventEmitter {
  private process: ChildProcess | null = null;
  private sessionId: string = '';
  private buffer: string = '';

  constructor() {
    super();
  }

  /**
   * Execute a Claude Code command and stream the results.
   * Uses `claude -p` with `--output-format stream-json`.
   */
  async execute(options: ExecuteOptions): Promise<void> {
    const args: string[] = [
      '-p', options.prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    // Resume existing session
    if (options.session_id) {
      args.push('--resume', options.session_id);
    }

    // Set allowed tools (disabled for now — debugging)
    // if (options.allowed_tools && options.allowed_tools.length > 0) {
    //   args.push('--allowedTools', options.allowed_tools.join(','));
    // }

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

      debugLog(`Spawning: claude ${args.join(' ')}`);
      debugLog(`CWD: ${cwd}`);

      this.process = spawn('claude', args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      debugLog(`Spawned PID: ${this.process.pid}`);
      debugLog(`stdout exists: ${!!this.process.stdout}`);
      debugLog(`stderr exists: ${!!this.process.stderr}`);

      this.buffer = '';

      this.process.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        debugLog(`STDOUT: ${text.length} bytes: ${text.slice(0, 200)}`);
        this.buffer += text;
        this.processBuffer();
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        debugLog(`STDERR: ${text.slice(0, 200)}`);
        if (text) {
          this.emit('message', {
            type: 'system',
            content: [{ type: 'text', text }],
          } as ClaudeStreamMessage);
        }
      });

      this.process.on('error', (err) => {
        debugLog(`ERROR: ${err.message}`);
        this.emit('error', err);
        reject(err);
      });

      this.process.on('close', (code) => {
        debugLog(`CLOSE: code=${code}`);
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
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as ClaudeStreamMessage;

        // Capture session ID from init message
        if (msg.type === 'init' || msg.session_id) {
          this.sessionId = msg.session_id || this.sessionId;
        }

        console.error(`[DEBUG] emitting message type: ${msg.type}`);
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
          } as ClaudeResult);
        }
      } catch {
        // Not valid JSON — might be a partial line or plain text output
        // Just skip it
      }
    }
  }

  /** Cancel the currently running command */
  cancel(): void {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }
  }

  /** Get the current session ID (available after first message) */
  getSessionId(): string {
    return this.sessionId;
  }
}
