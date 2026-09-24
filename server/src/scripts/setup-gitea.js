// One-time Gitea setup, run on the VM once Gitea is up:
//   docker compose run --rm api node src/scripts/setup-gitea.js
// Creates (idempotently) the system-wide push webhook that feeds the correction queue.
import { config, secret } from '../config.js';
import { giteaRequest } from '../gitea.js';

const webhookUrl = process.env.WEBHOOK_TARGET_URL || `http://webhook:${config.webhookPort}/webhook`;

async function ensureSystemWebhook() {
  const hooks = await giteaRequest('GET', '/admin/hooks?limit=50').catch(() => []);
  const existing = hooks.find((h) => h.config?.url === webhookUrl);
  if (existing) {
    console.log(`System webhook already present (#${existing.id}) -> ${webhookUrl}`);
    return;
  }
  const hook = await giteaRequest('POST', '/admin/hooks', {
    type: 'gitea',
    active: true,
    is_system_webhook: true,
    events: ['push'],
    branch_filter: 'main',
    config: { url: webhookUrl, content_type: 'json', secret: secret('GITEA_WEBHOOK_SECRET') },
  });
  console.log(`Created system webhook #${hook.id} -> ${webhookUrl}`);
}

try {
  await ensureSystemWebhook();
  console.log('\nDone.');
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
