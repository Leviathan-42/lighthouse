import { loadConfig } from './lib/config.js';
import { buildServer } from './server.js';

async function main() {
  const config = loadConfig();
  const server = await buildServer(config);

  const shutdown = async (signal: string) => {
    server.log.info({ signal }, 'shutting down');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    const address = await server.listen({ port: config.LIGHTHOUSE_PORT, host: config.LIGHTHOUSE_HOST });
    server.log.info({ address }, 'lighthouse-api listening');
  } catch (err) {
    server.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err);
  process.exit(1);
});
