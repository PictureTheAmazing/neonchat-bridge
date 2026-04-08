import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pc from 'picocolors';
const GITHUB_API = 'https://api.github.com/repos/PictureTheAmazing/neonchat-bridge/commits/master';
const UPDATE_CHECK_FILE = join(homedir(), '.neonchat-bridge-version');
/**
 * Check for updates from GitHub and auto-update if available.
 * Called on bridge startup.
 */
export async function checkForUpdates(verbose = false) {
    try {
        // Fetch latest commit hash from GitHub
        const response = await fetch(GITHUB_API, {
            headers: { 'User-Agent': 'neonchat-bridge' },
        });
        if (!response.ok) {
            if (verbose)
                console.log(pc.dim('⚠ Could not check for updates (GitHub API unavailable)'));
            return;
        }
        const data = await response.json();
        const latestCommit = data.sha?.substring(0, 7);
        if (!latestCommit) {
            if (verbose)
                console.log(pc.dim('⚠ Could not parse latest commit from GitHub'));
            return;
        }
        // Get current version (commit hash baked into package at build time)
        // For now, we'll use a simple file-based check
        let currentVersion = null;
        try {
            const fs = await import('node:fs');
            currentVersion = fs.readFileSync(UPDATE_CHECK_FILE, 'utf-8').trim();
        }
        catch {
            // First run or file doesn't exist
        }
        if (currentVersion && currentVersion === latestCommit) {
            if (verbose)
                console.log(pc.dim(`✓ Bridge is up to date (${latestCommit})`));
            return;
        }
        // Update available!
        if (currentVersion) {
            console.log(pc.yellow(`🔄 Update available: ${currentVersion} → ${latestCommit}`));
        }
        else {
            console.log(pc.cyan(`✨ First run detected, caching version ${latestCommit}`));
        }
        // Clear npx cache to force fresh download on next start
        const npxCache = join(homedir(), '.npm', '_npx');
        try {
            rmSync(npxCache, { recursive: true, force: true });
            if (verbose)
                console.log(pc.dim('✓ Cleared npx cache'));
        }
        catch (err) {
            if (verbose)
                console.log(pc.dim('⚠ Could not clear npx cache (may already be clean)'));
        }
        // Save new version
        const fs = await import('node:fs');
        fs.writeFileSync(UPDATE_CHECK_FILE, latestCommit, 'utf-8');
        if (currentVersion) {
            // If this was an update, restart the bridge
            console.log(pc.green('✓ Bridge updated! Restarting...'));
            console.log();
            // Re-execute the same command
            const args = process.argv.slice(1); // Skip node executable
            try {
                execSync(`npx github:PictureTheAmazing/neonchat-bridge ${args.join(' ')}`, {
                    stdio: 'inherit',
                });
                process.exit(0);
            }
            catch (err) {
                console.log(pc.red('✗ Failed to restart bridge'));
                console.log(pc.dim('Please restart manually: npx github:PictureTheAmazing/neonchat-bridge start'));
                process.exit(1);
            }
        }
    }
    catch (err) {
        if (verbose) {
            console.log(pc.dim('⚠ Update check failed:'), err instanceof Error ? err.message : String(err));
        }
        // Non-fatal: continue starting the bridge
    }
}
//# sourceMappingURL=updater.js.map