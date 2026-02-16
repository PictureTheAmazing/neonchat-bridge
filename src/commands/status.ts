import pc from 'picocolors';
import { getConfig, getConfigPath } from '../config.js';
import { execSync } from 'node:child_process';

export async function status(): Promise<void> {
  const config = getConfig();

  if (!config.is_configured) {
    console.log(pc.red('✗ Agent not configured'));
    console.log(pc.dim('Run: neonchat-bridge setup --token <token>'));
    return;
  }

  let claudeVersion = 'not found';
  try {
    claudeVersion = execSync('claude --version', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch { /* ignore */ }

  console.log(pc.bold('Agent Configuration:'));
  console.log(`  ${pc.dim('Agent ID:')}     ${config.agent_id}`);
  console.log(`  ${pc.dim('Name:')}         ${config.device_name}`);
  console.log(`  ${pc.dim('Server:')}       ${config.server_url}`);
  console.log(`  ${pc.dim('Working Dir:')}  ${config.default_working_dir}`);
  console.log(`  ${pc.dim('Claude Code:')}  ${claudeVersion}`);
  console.log(`  ${pc.dim('Config File:')} ${getConfigPath()}`);
  console.log(`  ${pc.dim('Tools:')}        ${config.allowed_tools.join(', ')}`);
  console.log();

  // Check if we can reach the server
  try {
    const response = await fetch(`${config.server_url}/api/health`, { 
      signal: AbortSignal.timeout(5000) 
    });
    if (response.ok) {
      console.log(`  ${pc.green('✓')} Server is reachable`);
    } else {
      console.log(`  ${pc.yellow('⚠')} Server responded with ${response.status}`);
    }
  } catch {
    console.log(`  ${pc.red('✗')} Cannot reach server at ${config.server_url}`);
  }

  // Check if Claude Code is available
  if (claudeVersion !== 'not found') {
    console.log(`  ${pc.green('✓')} Claude Code is installed`);
  } else {
    console.log(`  ${pc.red('✗')} Claude Code not found in PATH`);
  }
}
