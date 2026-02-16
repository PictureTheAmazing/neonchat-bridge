import Conf from 'conf';
import { createHash, randomBytes } from 'node:crypto';

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

const config = new Conf<BridgeConfig>({
  projectName: 'neonchat-bridge',
  defaults: {
    agent_id: '',
    device_token: '',
    server_url: 'http://localhost:8090',
    device_name: '',
    default_working_dir: process.cwd(),
    allowed_tools: ['Read', 'Bash', 'Write', 'Edit', 'Glob', 'Grep'],
    is_configured: false,
  },
});

export function getConfig(): BridgeConfig {
  return {
    agent_id: config.get('agent_id'),
    device_token: config.get('device_token'),
    server_url: config.get('server_url'),
    device_name: config.get('device_name'),
    default_working_dir: config.get('default_working_dir'),
    allowed_tools: config.get('allowed_tools'),
    is_configured: config.get('is_configured'),
  };
}

export function setConfig(updates: Partial<BridgeConfig>): void {
  for (const [key, value] of Object.entries(updates)) {
    config.set(key as keyof BridgeConfig, value);
  }
}

export function getConfigPath(): string {
  return config.path;
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
