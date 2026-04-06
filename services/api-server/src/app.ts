import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";

import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { contestRoutes } from "./routes/contests.js";
import { requestRoutes } from "./routes/requests.js";
import { walletRoutes } from "./routes/wallet.js";
import { config } from "./env.js";
import { redis } from "./lib/redis.js";
import { resolveTenant } from "./lib/tenant.js";

function isAllowedDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    const isLocalHost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.startsWith("10.") ||
      url.hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname);

    return isLocalHost && /^300[0-5]$/.test(url.port);
  } catch {
    return false;
  }
}

export async function buildApp() {
  const app = Fastify({ logger: true });
  const allowedOrigins = new Set(config.frontendUrls);

  await app.register(cors, {
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-Slug"],
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, origin);
        return;
      }

      if (process.env.NODE_ENV !== "production" && isAllowedDevOrigin(origin)) {
        callback(null, origin);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true
  });
  await app.register(cookie);

  app.get("/health", async () => ({
    ok: true,
    service: "api-server"
  }));

  // All tenant-scoped routes run behind the tenant resolver.
  // The resolver reads X-Tenant-Slug header (defaults to "default").
  await app.register(async (tenantApp) => {
    tenantApp.addHook("preHandler", resolveTenant);
    await tenantApp.register(authRoutes);
    await tenantApp.register(requestRoutes);
    await tenantApp.register(walletRoutes);
    await tenantApp.register(contestRoutes);
    await tenantApp.register(adminRoutes);
  });

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
