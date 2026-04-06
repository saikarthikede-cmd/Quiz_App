import { config } from "./env.js";
import { buildApp } from "./app.js";
import { redis } from "./lib/redis.js";

const app = await buildApp();

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down API server");

  try {
    await app.close();
  } catch (error) {
    app.log.error({ error }, "Failed to close Fastify cleanly");
  }

  try {
    await redis.quit();
  } catch (error) {
    app.log.error({ error }, "Failed to close Redis cleanly");
  }

  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await redis.connect();
  await app.listen({
    host: "0.0.0.0",
    port: config.apiPort
  });
  app.log.info({ port: config.apiPort }, "API server listening");
} catch (error) {
  app.log.error({ error }, "API server failed to start");

  try {
    await redis.quit();
  } catch {
    // Ignore secondary cleanup failures during startup.
  }

  process.exit(1);
}
