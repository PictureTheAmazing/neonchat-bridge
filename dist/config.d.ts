export interface BridgeConfig {
    /** Unique ID for this agent */
    agent_id: string;
    /** Auth token for connecting to NeonChat backend */
    device_token: string;
    /** NeonChat server URL */
    server_url: string;
    /** Friendly name for this device */
    device_name: string;
    /** Default working directory for Claude Code */
    default_working_dir: string;
    /** Default allowed tools */
    allowed_tools: string[];
    /** Whether this agent has been set up */
    is_configured: boolean;
}
export declare function getConfig(): BridgeConfig;
export declare function setConfig(updates: Partial<BridgeConfig>): void;
export declare function getConfigPath(): string;
export declare function generateDeviceToken(): string;
export declare function hashToken(token: string): string;
//# sourceMappingURL=config.d.ts.map