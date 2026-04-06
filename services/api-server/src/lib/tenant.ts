import { pool } from "@quiz-app/db";
import type { FastifyReply, FastifyRequest } from "fastify";

const DEFAULT_TENANT_SLUG = "default";

/**
 * Resolves the active tenant from the request.
 * Priority: X-Tenant-Slug header -> "default".
 * Attaches request.tenant for downstream handlers.
 */
export async function resolveTenant(request: FastifyRequest, reply: FastifyReply) {
  const rawSlug = request.headers["x-tenant-slug"];
  const slug =
    typeof rawSlug === "string" && rawSlug.trim().length > 0
      ? rawSlug.trim().toLowerCase()
      : DEFAULT_TENANT_SLUG;

  const result = await pool.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM tenants WHERE slug = $1 AND is_active = TRUE LIMIT 1",
    [slug]
  );

  if (result.rowCount !== 1) {
    return reply.code(404).send({ message: "Tenant not found" });
  }

  request.tenant = result.rows[0];
}
