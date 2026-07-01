import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { createApp } from './app.js';

async function main() {
  await connectDb();
  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port} (${config.isProd ? 'prod' : 'dev'})`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[api] ${signal} received, shutting down…`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] fatal:', err.message);
  process.exit(1);
});
