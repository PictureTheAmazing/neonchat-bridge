import { EventEmitter } from 'node:events';
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
    tools?: string[];
    mcp_servers?: string[];
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
    session_id?: string;
    allowed_tools?: string[];
    mcp_config_path?: string;
    system_prompt_append?: string;
    timeout_ms?: number;
}
export declare class ClaudeCodeExecutor extends EventEmitter {
    private process;
    private sessionId;
    private buffer;
    constructor();
    /**
     * Execute a Claude Code command and stream the results.
     * Uses `claude -p` with `--output-format stream-json`.
     * Stdout is redirected to a temp file and polled, because Claude Code's
     * native binary doesn't write to Node.js socket-pair stdio on ARM64.
     */
    execute(options: ExecuteOptions): Promise<void>;
    /**
     * Process the buffer, parsing complete JSON lines.
     * Claude Code's stream-json outputs one JSON object per line.
     */
    private processBuffer;
    /** Cancel the currently running command */
    cancel(): void;
    /** Get the current session ID (available after first message) */
    getSessionId(): string;
}
//# sourceMappingURL=executor.d.ts.map