import Conf from 'conf';
import { createHash, randomBytes } from 'node:crypto';
const config = new Conf({
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
export function getConfig() {
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
export function setConfig(updates) {
    for (const [key, value] of Object.entries(updates)) {
        config.set(key, value);
    }
}
export function getConfigPath() {
    return config.path;
}
export function generateDeviceToken() {
    return randomBytes(32).toString('hex');
}
export function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
//# sourceMappingURL=config.js.map