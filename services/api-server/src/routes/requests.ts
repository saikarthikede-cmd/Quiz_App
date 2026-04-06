import { pool } from "@quiz-app/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticate } from "../lib/auth.js";

const requestNotesSchema = z.object({
  notes: z.string().trim().max(400).optional()
});

function isUniqueViolation(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "23505";
}

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export async function requestRoutes(app: FastifyInstance) {
  app.get("/requests/mine", { preHandler: authenticate }, async (request) => {
    const result = await pool.query<{
      id: string;
      request_type: "admin_access" | "exit";
      status: "pending" | "approved" | "rejected";
      notes: string | null;
      created_at: string;
      updated_at: string;
      reviewed_at: string | null;
    }>(
      `
        SELECT id, request_type, status, notes, created_at, updated_at, reviewed_at
        FROM access_requests
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [request.user.id]
    );

    return { requests: result.rows };
  });

  app.post("/requests/admin-access", { preHandler: authenticate }, async (request, reply) => {
    if (request.user.is_platform_admin) {
      return reply.code(409).send({ message: "Main admin does not use organization admin requests" });
    }

    if (!request.user.onboarding_completed) {
      return reply.code(409).send({ message: "Complete onboarding before requesting admin access" });
    }

    if (request.user.is_admin) {
      return reply.code(409).send({ message: "You already have admin access for this organization" });
    }

    if (request.tenant.id === PLATFORM_TENANT_ID || request.user.user_type !== "employee") {
      return reply.code(409).send({ message: "Only organization employees can request admin access" });
    }

    const body = requestNotesSchema.parse(request.body ?? {});

    try {
      const result = await pool.query<{
        id: string;
        request_type: "admin_access";
        status: "pending";
        created_at: string;
      }>(
        `
          INSERT INTO access_requests (user_id, tenant_id, request_type, notes)
          VALUES ($1, $2, 'admin_access', $3)
          RETURNING id, request_type, status, created_at
        `,
        [request.user.id, request.tenant.id, body.notes ?? null]
      );

      return {
        success: true,
        request: result.rows[0],
        message: "Admin access request sent to the main admin for review"
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ message: "An admin access request is already pending for this organization" });
      }

      throw error;
    }
  });

  app.post("/requests/exit", { preHandler: authenticate }, async (request, reply) => {
    if (request.user.is_platform_admin) {
      return reply.code(409).send({ message: "Main admin cannot request organization exit" });
    }

    if (!request.user.onboarding_completed) {
      return reply.code(409).send({ message: "Complete onboarding before requesting exit" });
    }

    if (request.tenant.id === PLATFORM_TENANT_ID || request.user.user_type !== "employee") {
      return reply.code(409).send({ message: "Only organization employees can request exit" });
    }

    const body = requestNotesSchema.parse(request.body ?? {});

    try {
      const result = await pool.query<{
        id: string;
        request_type: "exit";
        status: "pending";
        created_at: string;
      }>(
        `
          INSERT INTO access_requests (user_id, tenant_id, request_type, notes)
          VALUES ($1, $2, 'exit', $3)
          RETURNING id, request_type, status, created_at
        `,
        [request.user.id, request.tenant.id, body.notes ?? null]
      );

      return {
        success: true,
        request: result.rows[0],
        message: "Exit request sent for approval"
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ message: "An exit request is already pending for this organization" });
      }

      throw error;
    }
  });
}
