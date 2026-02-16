import pc from 'picocolors';
import { getConfig, getConfigPath } from '../config.js';
import { ConnectionManager } from '../connection.js';
export async function start(opts) {
    const config = getConfig();
    if (!config.is_configured) {
        console.log(pc.red('✗ Agent not configured yet.'));
        console.log(pc.dim('Run: neonchat-bridge setup --token <token>'));
        process.exit(1);
    }
    console.log(`${pc.dim('Agent:')} ${pc.bold(config.device_name)} ${pc.dim(`(${config.agent_id.slice(0, 8)}...)`)}`);
    console.log(`${pc.dim('Server:')} ${opts.server || config.server_url}`);
    console.log(`${pc.dim('Working dir:')} ${config.default_working_dir}`);
    console.log(`${pc.dim('Config:')} ${getConfigPath()}`);
    console.log();
    const manager = new ConnectionManager(opts.verbose);
    // Handle graceful shutdown
    const shutdown = async (signal) => {
        console.log(pc.yellow(`\n${signal} received, shutting down...`));
        await manager.disconnect();
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Connect and keep running
    try {
        await manager.connect();
        console.log(pc.green('⚡ Bridge agent is running. Press Ctrl+C to stop.'));
        console.log(pc.dim('Waiting for commands from NeonChat...'));
        console.log();
    }
    catch (err) {
        console.log(pc.red('Failed to connect to NeonChat server.'));
        if (err instanceof Error) {
            console.log(pc.dim(err.message));
        }
        console.log(pc.dim('The agent will keep retrying automatically.'));
    }
    // Keep the process alive
    await new Promise(() => { }); // Never resolves — keeps event loop running
}
//# sourceMappingURL=start.js.map