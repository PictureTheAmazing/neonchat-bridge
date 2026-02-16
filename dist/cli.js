#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { setup } from './commands/setup.js';
import { start } from './commands/start.js';
import { status } from './commands/status.js';
const program = new Command();
const BANNER = `
${pc.cyan('╔══════════════════════════════════════╗')}
${pc.cyan('║')}  ${pc.bold(pc.magenta('⚡ NeonChat Bridge Agent'))}            ${pc.cyan('║')}
${pc.cyan('║')}  ${pc.dim('Connect Claude Code to NeonChat')}     ${pc.cyan('║')}
${pc.cyan('╚══════════════════════════════════════╝')}
`;
program
    .name('neonchat-bridge')
    .description('NeonChat Bridge Agent — Control Claude Code remotely')
    .version('0.1.0')
    .hook('preAction', () => {
    console.log(BANNER);
});
program
    .command('setup')
    .description('Register this machine with NeonChat')
    .option('--token <token>', 'Setup token from NeonChat UI')
    .option('--dev', 'Dev mode — skip PocketBase registration')
    .option('--name <name>', 'Friendly name for this device')
    .option('--server <url>', 'WS sidecar URL (for agent connection)', 'http://localhost:8091')
    .option('--pb-url <url>', 'PocketBase URL (for registration)', 'http://localhost:8090')
    .action(async (opts) => {
    await setup(opts);
});
program
    .command('start')
    .description('Start the bridge agent daemon')
    .option('--server <url>', 'NeonChat server URL override')
    .option('--verbose', 'Enable verbose logging', false)
    .action(async (opts) => {
    await start(opts);
});
program
    .command('status')
    .description('Show current agent status')
    .action(async () => {
    await status();
});
program
    .command('login')
    .description('Authenticate with NeonChat (interactive)')
    .option('--server <url>', 'NeonChat server URL', 'http://localhost:8090')
    .action(async (_opts) => {
    console.log(pc.yellow('Interactive login coming soon — use setup --token for now'));
});
program
    .command('service')
    .description('Manage the bridge agent as a system service')
    .argument('<action>', 'install | start | stop | status | uninstall')
    .action(async (action) => {
    console.log(pc.yellow(`Service management (${action}) coming soon`));
    console.log(pc.dim('For now, use: neonchat-bridge start'));
});
program.parse();
//# sourceMappingURL=cli.js.map