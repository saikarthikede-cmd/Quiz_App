import { config } from "./env.js";
import { buildApp } from "./app.js";
import { redis } from "./lib/redis.js";

const app = await buildApp();

await redis.connect();
await app.listen({
  host: "0.0.0.0",
  port: config.apiPort
});
