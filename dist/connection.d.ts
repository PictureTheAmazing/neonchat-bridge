export declare class ConnectionManager {
    private ws;
    private executor;
    private heartbeatTimer;
    private reconnectTimer;
    private reconnectDelay;
    private currentStatus;
    private currentSessionId;
    private verbose;
    private isShuttingDown;
    constructor(verbose?: boolean);
    /** Connect to the NeonChat backend WebSocket */
    connect(): Promise<void>;
    /** Handle incoming messages from NeonChat backend */
    private handleMessage;
    /** Execute a Claude Code command */
    private executeCommand;
    /** Cancel the current execution */
    private cancelExecution;
    /** Browse files on this machine (read-only) */
    private browseFiles;
    /** Send a response back to NeonChat */
    private sendResponse;
    /** Send a heartbeat with current system info */
    private sendHeartbeat;
    private startHeartbeat;
    private stopHeartbeat;
    /** Reconnect with exponential backoff */
    private scheduleReconnect;
    /** Gracefully disconnect */
    disconnect(): Promise<void>;
    private log;
}
//# sourceMappingURL=connection.d.ts.map