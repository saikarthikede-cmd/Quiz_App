import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";

import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { contestRoutes } from "./routes/contests.js";
import { walletRoutes } from "./routes/wallet.js";
import { config } from "./env.js";
import { redis } from "./lib/redis.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.frontendUrl,
    credentials: true
  });
  await app.register(cookie);

  app.get("/health", async () => ({
    ok: true,
    service: "api-server"
  }));

  await app.register(authRoutes);
  await app.register(walletRoutes);
  await app.register(contestRoutes);
  await app.register(adminRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: "Validation failed",
        issues: error.issues
      });
    }

    reply.log.error({ err: error }, "Unhandled API error");
    return reply.code(500).send({
      message: error instanceof Error ? error.message : "Internal server error"
    });
  });

  app.addHook("onClose", async () => {
    await redis.quit();
  });

  return app;
}
