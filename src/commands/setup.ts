import pc from 'picocolors';
import ora from 'ora';
import { hostname, platform, arch, type as osType, userInfo } from 'node:os';
import { execSync } from 'node:child_process';
import { setConfig, generateDeviceToken, hashToken } from '../config.js';

interface SetupOpts {
  token?: string;
  dev?: boolean;
  name?: string;
  server: string;
  pbUrl: string;
}

function getClaudeCodeVersion(): string {
  try {
    const output = execSync('claude --version', { encoding: 'utf8', timeout: 5000 });
    return output.trim();
  } catch {
    return 'not found';
  }
}

export async function setup(opts: SetupOpts): Promise<void> {
  const spinner = ora('Checking system...').start();

  // Gather system info
  const systemHostname = hostname();
  const systemPlatform = platform();
  const systemArch = arch();
  const systemOs = osType();
  const claudeVersion = getClaudeCodeVersion();
  const deviceName = opts.name || `${userInfo().username}@${systemHostname}`;

  spinner.text = 'Checking Claude Code installation...';

  if (claudeVersion === 'not found') {
    spinner.fail(pc.red('Claude Code is not installed or not in PATH'));
    console.log(pc.dim('Install it with: npm install -g @anthropic-ai/claude-code'));
    console.log(pc.dim('Or see: https://code.claude.com/docs'));
    process.exit(1);
  }

  spinner.succeed(`Claude Code found: ${pc.green(claudeVersion)}`);
  console.log(`  ${pc.dim('Device:')} ${deviceName}`);
  console.log(`  ${pc.dim('OS:')} ${systemOs} ${systemPlatform} ${systemArch}`);
  console.log(`  ${pc.dim('Server:')} ${opts.server}`);
  console.log();

  // Generate a device token for ongoing auth
  const deviceToken = generateDeviceToken();
  const tokenHash = hashToken(deviceToken);

  // Dev mode — register locally without PocketBase
  if (opts.dev) {
    const { nanoid } = await import('nanoid');
    const agentId = nanoid(15);

    setConfig({
      agent_id: agentId,
      device_token: deviceToken,
      server_url: opts.server,
      device_name: deviceName,
      default_working_dir: process.cwd(),
      is_configured: true,
    });

    console.log(pc.green('✓ Dev mode — registered locally (no PocketBase)'));
    console.log();
    console.log(`  ${pc.bold('Agent ID:')} ${pc.cyan(agentId)}`);
    console.log(`  ${pc.bold('Name:')} ${deviceName}`);
    console.log(`  ${pc.bold('Server:')} ${opts.server}`);
    console.log();
    console.log(pc.green('Start the bridge with:'));
    console.log(pc.bold('  neonchat-bridge start'));
    console.log();
    return;
  }

  if (!opts.token) {
    console.log(pc.red('Error: --token is required (or use --dev for dev mode)'));
    process.exit(1);
  }

  // Register with the NeonChat backend
  const registerSpinner = ora('Registering with NeonChat...').start();

  try {
    const response = await fetch(`${opts.pbUrl}/api/agents/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opts.token}`, // one-time setup token
      },
      body: JSON.stringify({
        hostname: systemHostname,
        os: systemOs,
        platform: systemPlatform,
        arch: systemArch,
        claude_code_version: claudeVersion,
        name: deviceName,
        default_working_dir: process.cwd(),
        device_token_hash: tokenHash,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      registerSpinner.fail(pc.red(`Registration failed: ${response.status}`));
      console.log(pc.dim(error));
      process.exit(1);
    }

    const data = await response.json() as { agent_id: string };

    // Save config locally
    setConfig({
      agent_id: data.agent_id,
      device_token: deviceToken,
      server_url: opts.server,
      device_name: deviceName,
      default_working_dir: process.cwd(),
      is_configured: true,
    });

    registerSpinner.succeed(pc.green('Registered successfully!'));
    console.log();
    console.log(`  ${pc.bold('Agent ID:')} ${pc.cyan(data.agent_id)}`);
    console.log(`  ${pc.bold('Name:')} ${deviceName}`);
    console.log();
    console.log(pc.green('✓ Setup complete! Start the bridge with:'));
    console.log(pc.bold('  neonchat-bridge start'));
    console.log();
  } catch (err) {
    registerSpinner.fail(pc.red('Could not connect to NeonChat server'));
    console.log(pc.dim(`Is PocketBase running at ${opts.pbUrl}?`));
    if (err instanceof Error) {
      console.log(pc.dim(err.message));
    }
    process.exit(1);
  }
}
