// Re-export shared types
// When we publish as a monorepo these would come from @neonchat/shared
// For now we define them locally

export type AgentStatus = 'online' | 'offline' | 'busy' | 'error';

export interface AgentCommand {
  type: 'command' | 'resume' | 'cancel' | 'file_browse';
  request_id: string;
  session_id?: string;
  prompt: string;
  working_directory?: string;
  allowed_tools?: string[];
  mcp_config?: Record<string, unknown>;
}

export interface AgentResponse {
  type: 'stream' | 'result' | 'error' | 'status';
  request_id: string;
  session_id?: string;
  message?: AgentMessage;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  error?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface AgentHeartbeat {
  type: 'heartbeat';
  agent_id: string;
  status: AgentStatus;
  system_info: SystemInfo;
  current_session?: string;
  timestamp: string;
}

export interface SystemInfo {
  hostname: string;
  os: string;
  platform: string;
  arch: string;
  claude_code_version: string;
  uptime_seconds: number;
  memory_usage_mb: number;
  node_version: string;
  default_working_dir: string;
}
