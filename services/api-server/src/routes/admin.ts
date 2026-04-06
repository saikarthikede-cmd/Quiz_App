import { mutateWalletBalance, pool, withTransaction } from "@quiz-app/db";
import {
  CONTEST_LIFECYCLE_QUEUE,
  contestLifecycleJobNames,
  contestLifecycleQueue,
  getQueueByName,
  PAYOUTS_QUEUE,
  payoutsQueue
} from "@quiz-app/queues";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAdmin, requirePlatformAdmin } from "../lib/auth.js";
import { rebuildContestCache } from "../lib/contest-cache.js";
import { ensureContestJobs } from "../lib/contest-jobs.js";

const makeJobId = (...parts: Array<string | number>) => parts.join("__");

const contestSchema = z.object({
  title: z.string().min(3).max(120),
  starts_at: z.iso.datetime(),
  entry_fee: z.number().positive(),
  max_members: z.number().int().positive().max(100),
  prize_rule: z.enum(["all_correct", "top_scorer"]).default("all_correct")
});

const questionSchema = z.object({
  seq: z.number().int().positive(),
  body: z.string().min(5),
  option_a: z.string().min(1),
  option_b: z.string().min(1),
  option_c: z.string().min(1),
  option_d: z.string().min(1),
  correct_option: z.enum(["a", "b", "c", "d"]),
  time_limit_sec: z.number().int().positive().max(120)
});

const amountSchema = z.object({
  amount: z.number().positive().max(100000)
});

const walletRequestDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"])
});

const accessRequestDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"])
});

const tenantCreateSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/),
  plan: z.enum(["standard", "pro", "enterprise"]).default("standard"),
  company_type: z.enum(["college", "company"]).default("company"),
  code_or_reference_id: z.string().min(1).max(80).optional(),
  id_pattern: z.string().min(1).max(120).optional()
});

const tenantUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  plan: z.enum(["standard", "pro", "enterprise"]).optional(),
  company_type: z.enum(["college", "company"]).optional(),
  code_or_reference_id: z.string().min(1).max(80).nullable().optional(),
  id_pattern: z.string().min(1).max(120).nullable().optional(),
  is_active: z.boolean().optional()
});

async function assertTenantContestAccess(
  contestId: string,
  tenantId: string
) {
  const contestResult = await pool.query<{ id: string }>(
    "SELECT id FROM contests WHERE id = $1 AND tenant_id = $2 LIMIT 1",
    [contestId, tenantId]
  );

  return contestResult.rowCount === 1;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/tenants", { preHandler: requirePlatformAdmin }, async () => {
    const result = await pool.query<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      company_type: string;
      code_or_reference_id: string | null;
      id_pattern: string | null;
      is_active: boolean;
      created_at: string;
      user_count: string;
      admin_count: string;
      contest_count: string;
    }>(
      `
        SELECT
          t.id,
          t.name,
          t.slug,
          t.plan,
          t.company_type,
          t.code_or_reference_id,
          t.id_pattern,
          t.is_active,
          t.created_at,
          COUNT(DISTINCT u.id)::text AS user_count,
          COUNT(DISTINCT CASE WHEN u.is_admin THEN u.id END)::text AS admin_count,
          COUNT(DISTINCT c.id)::text AS contest_count
        FROM tenants t
        LEFT JOIN users u ON u.tenant_id = t.id
        LEFT JOIN contests c ON c.tenant_id = t.id
        GROUP BY t.id, t.name, t.slug, t.plan, t.company_type, t.code_or_reference_id, t.id_pattern, t.is_active, t.created_at
        ORDER BY t.created_at ASC
      `
    );

    return { tenants: result.rows };
  });

  app.post("/admin/tenants", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const body = tenantCreateSchema.parse(request.body);

    const duplicateNameResult = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM tenants
        WHERE LOWER(name) = LOWER($1)
          AND company_type = $2
        LIMIT 1
      `,
      [body.name.trim(), body.company_type]
    );

    if ((duplicateNameResult.rowCount ?? 0) > 0) {
      return reply.code(409).send({ message: "A company or college with this name already exists" });
    }

    try {
      const result = await pool.query<{
        id: string;
        name: string;
        slug: string;
        plan: string;
        company_type: string;
        code_or_reference_id: string | null;
        id_pattern: string | null;
        is_active: boolean;
        created_at: string;
      }>(
        `
          INSERT INTO tenants (name, slug, plan, company_type, code_or_reference_id, id_pattern)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, name, slug, plan, company_type, code_or_reference_id, id_pattern, is_active, created_at
        `,
        [
          body.name.trim(),
          body.slug.trim().toLowerCase(),
          body.plan,
          body.company_type,
          body.code_or_reference_id?.trim() ?? null,
          body.id_pattern?.trim() ?? null
        ]
      );

      return { tenant: result.rows[0] };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505") {
        return reply.code(409).send({ message: "Tenant slug already exists" });
      }

      throw error;
    }
  });

  app.patch("/admin/tenants/:id", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const tenantId = String((request.params as { id: string }).id);
    const body = tenantUpdateSchema.parse(request.body);

    if (Object.keys(body).length === 0) {
      return reply.code(400).send({ message: "No tenant changes provided" });
    }

    if (body.name || body.company_type) {
      const currentTenantResult = await pool.query<{ name: string; company_type: string }>(
        "SELECT name, company_type FROM tenants WHERE id = $1 LIMIT 1",
        [tenantId]
      );

      if (currentTenantResult.rowCount !== 1) {
        return reply.code(404).send({ message: "Tenant not found" });
      }

      const nextName = body.name?.trim() ?? currentTenantResult.rows[0].name;
      const nextType = body.company_type ?? currentTenantResult.rows[0].company_type;

      const duplicateNameResult = await pool.query<{ id: string }>(
        `
          SELECT id
          FROM tenants
          WHERE LOWER(name) = LOWER($1)
            AND company_type = $2
            AND id <> $3
          LIMIT 1
        `,
        [nextName, nextType, tenantId]
      );

      if ((duplicateNameResult.rowCount ?? 0) > 0) {
        return reply.code(409).send({ message: "Another company or college already uses this name" });
      }
    }

    const result = await pool.query<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      company_type: string;
      code_or_reference_id: string | null;
      id_pattern: string | null;
      is_active: boolean;
      created_at: string;
    }>(
      `
        UPDATE tenants
        SET
          name = COALESCE($2, name),
          plan = COALESCE($3, plan),
          company_type = COALESCE($4, company_type),
          code_or_reference_id = COALESCE($5, code_or_reference_id),
          id_pattern = COALESCE($6, id_pattern),
          is_active = COALESCE($7, is_active),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, slug, plan, company_type, code_or_reference_id, id_pattern, is_active, created_at
      `,
      [
        tenantId,
        body.name?.trim() ?? null,
        body.plan ?? null,
        body.company_type ?? null,
        body.code_or_reference_id === undefined ? null : body.code_or_reference_id,
        body.id_pattern === undefined ? null : body.id_pattern,
        body.is_active ?? null
      ]
    );

    if (result.rowCount !== 1) {
      return reply.code(404).send({ message: "Tenant not found" });
    }

    return { tenant: result.rows[0] };
  });

  app.delete("/admin/tenants/:id", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const tenantId = String((request.params as { id: string }).id);

    if (tenantId === "00000000-0000-0000-0000-000000000001") {
      return reply.code(409).send({ message: "The default public tenant cannot be deleted" });
    }

    const result = await pool.query<{ id: string; slug: string }>(
      `
        DELETE FROM tenants
        WHERE id = $1
        RETURNING id, slug
      `,
      [tenantId]
    );

    if (result.rowCount !== 1) {
      return reply.code(404).send({ message: "Tenant not found" });
    }

    return { success: true, tenant: result.rows[0] };
  });

  app.get("/admin/platform/users", { preHandler: requirePlatformAdmin }, async (request) => {
    const tenantFilter = typeof (request.query as { tenant_id?: string }).tenant_id === "string"
      ? (request.query as { tenant_id?: string }).tenant_id
      : null;

    const result = await pool.query<{
      id: string;
      email: string;
      name: string;
      wallet_balance: string;
      is_admin: boolean;
      is_platform_admin: boolean;
      is_banned: boolean;
      created_at: string;
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      user_type: string | null;
      membership_type: string | null;
      onboarding_completed: boolean;
    }>(
      `
        SELECT
          u.id,
          u.email,
          u.name,
          u.wallet_balance,
          u.is_admin,
          u.is_platform_admin,
          u.is_banned,
          u.created_at,
          u.tenant_id,
          t.name AS tenant_name,
          t.slug AS tenant_slug,
          u.user_type,
          u.membership_type,
          u.onboarding_completed
        FROM users u
        INNER JOIN tenants t ON t.id = u.tenant_id
        WHERE ($1::uuid IS NULL OR u.tenant_id = $1)
        ORDER BY t.name ASC, u.created_at ASC
      `,
      [tenantFilter]
    );

    return { users: result.rows };
  });

  app.get("/admin/platform/tenants/:id/admin-requests", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const tenantId = String((request.params as { id: string }).id);

    const tenantResult = await pool.query<{ id: string; name: string; slug: string }>(
      "SELECT id, name, slug FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId]
    );

    if (tenantResult.rowCount !== 1) {
      return reply.code(404).send({ message: "Tenant not found" });
    }

    const [adminsResult, pendingAdminRequestsResult, pendingExitRequestsResult] = await Promise.all([
      pool.query<{
        id: string;
        email: string;
        name: string;
        user_type: string | null;
        created_at: string;
      }>(
        `
          SELECT id, email, name, user_type, created_at
          FROM users
          WHERE tenant_id = $1
            AND is_admin = TRUE
            AND is_platform_admin = FALSE
          ORDER BY created_at ASC
        `,
        [tenantId]
      ),
      pool.query<{
        id: string;
        request_type: "admin_access";
        status: "pending";
        notes: string | null;
        created_at: string;
        user_id: string;
        user_name: string;
        user_email: string;
      }>(
        `
          SELECT
            ar.id,
            ar.request_type,
            ar.status,
            ar.notes,
            ar.created_at,
            u.id AS user_id,
            u.name AS user_name,
            u.email AS user_email
          FROM access_requests ar
          INNER JOIN users u ON u.id = ar.user_id
          WHERE ar.tenant_id = $1
            AND ar.request_type = 'admin_access'
            AND ar.status = 'pending'
          ORDER BY ar.created_at ASC
        `,
        [tenantId]
      ),
      pool.query<{
        id: string;
        request_type: "exit";
        status: "pending";
        notes: string | null;
        created_at: string;
        user_id: string;
        user_name: string;
        user_email: string;
      }>(
        `
          SELECT
            ar.id,
            ar.request_type,
            ar.status,
            ar.notes,
            ar.created_at,
            u.id AS user_id,
            u.name AS user_name,
            u.email AS user_email
          FROM access_requests ar
          INNER JOIN users u ON u.id = ar.user_id
          WHERE ar.tenant_id = $1
            AND ar.request_type = 'exit'
            AND ar.status = 'pending'
          ORDER BY ar.created_at ASC
        `,
        [tenantId]
      )
    ]);

    return {
      tenant: tenantResult.rows[0],
      admins: adminsResult.rows,
      admin_requests: pendingAdminRequestsResult.rows,
      exit_requests: pendingExitRequestsResult.rows
    };
  });

  app.post("/admin/platform/access-requests/:id/review", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const accessRequestId = String((request.params as { id: string }).id);
    const body = accessRequestDecisionSchema.parse(request.body);
    const platformTenantId = "00000000-0000-0000-0000-000000000001";

    const result = await withTransaction(async (client) => {
      const requestResult = await client.query<{
        id: string;
        user_id: string;
        tenant_id: string;
        request_type: "admin_access" | "exit";
        status: "pending" | "approved" | "rejected";
      }>(
        `
          SELECT id, user_id, tenant_id, request_type, status
          FROM access_requests
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [accessRequestId]
      );

      if (requestResult.rowCount !== 1) {
        return reply.code(404).send({ message: "Access request not found" });
      }

      const accessRequest = requestResult.rows[0];

      if (accessRequest.status !== "pending") {
        return reply.code(409).send({ message: "Access request has already been reviewed" });
      }

      if (body.status === "approved") {
        if (accessRequest.request_type === "admin_access") {
          await client.query(
            `
              UPDATE users
              SET is_admin = TRUE, updated_at = NOW()
              WHERE id = $1
                AND tenant_id = $2
            `,
            [accessRequest.user_id, accessRequest.tenant_id]
          );
        } else {
          await client.query(
            `
              UPDATE users
              SET
                tenant_id = $2,
                is_admin = FALSE,
                user_type = NULL,
                username = NULL,
                college_name = NULL,
                student_id = NULL,
                company_name = NULL,
                membership_type = NULL,
                entered_reference_id = NULL,
                onboarding_completed = FALSE,
                updated_at = NOW()
              WHERE id = $1
            `,
            [accessRequest.user_id, platformTenantId]
          );

          await client.query(
            `
              UPDATE oauth_accounts
              SET tenant_id = $2
              WHERE user_id = $1
            `,
            [accessRequest.user_id, platformTenantId]
          );

          await client.query(
            `
              UPDATE access_requests
              SET
                status = 'rejected',
                reviewed_at = NOW(),
                reviewed_by = $2,
                updated_at = NOW()
              WHERE user_id = $1
                AND tenant_id = $3
                AND request_type = 'admin_access'
                AND status = 'pending'
            `,
            [accessRequest.user_id, request.user.id, accessRequest.tenant_id]
          );
        }
      }

      await client.query(
        `
          UPDATE access_requests
          SET
            status = $2,
            reviewed_at = NOW(),
            reviewed_by = $3,
            updated_at = NOW()
          WHERE id = $1
        `,
        [accessRequest.id, body.status, request.user.id]
      );

      return {
        success: true,
        request_id: accessRequest.id,
        request_type: accessRequest.request_type,
        status: body.status
      };
    });

    return result;
  });

  app.patch("/admin/platform/users/:id/company-admin", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const userId = String((request.params as { id: string }).id);
    const body = z.object({ is_admin: z.boolean() }).parse(request.body);

    const existingUserResult = await pool.query<{
      id: string;
      is_admin: boolean;
      is_platform_admin: boolean;
      tenant_id: string;
      user_type: string | null;
      tenant_slug: string;
    }>(
      `
        SELECT u.id, u.is_admin, u.is_platform_admin, u.tenant_id, u.user_type, t.slug AS tenant_slug
        FROM users u
        INNER JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1
          AND u.is_platform_admin = FALSE
        LIMIT 1
      `,
      [userId]
    );

    if (existingUserResult.rowCount !== 1) {
      return reply.code(404).send({ message: "User not found or cannot be modified" });
    }

    const existingUser = existingUserResult.rows[0];

    if (body.is_admin && (existingUser.tenant_slug === "default" || existingUser.user_type !== "employee")) {
      return reply.code(409).send({ message: "Only organization employees can be promoted to company admin" });
    }

    const result = await pool.query<{
      id: string;
      is_admin: boolean;
      is_platform_admin: boolean;
      tenant_id: string;
    }>(
      `
        UPDATE users
        SET is_admin = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, is_admin, is_platform_admin, tenant_id
      `,
      [userId, body.is_admin]
    );

    return { user: result.rows[0] };
  });

  app.delete("/admin/platform/users/:id", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const userId = String((request.params as { id: string }).id);

    const result = await pool.query<{ id: string }>(
      `
        DELETE FROM users
        WHERE id = $1
          AND is_platform_admin = FALSE
        RETURNING id
      `,
      [userId]
    );

    if (result.rowCount !== 1) {
      return reply.code(404).send({ message: "User not found or cannot be removed" });
    }

    return { success: true };
  });

  app.delete("/admin/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const userId = String((request.params as { id: string }).id);

    if (userId === request.user.id) {
      return reply.code(409).send({ message: "Admins cannot remove their own active session user" });
    }

    const result = await pool.query<{ id: string }>(
      `
        DELETE FROM users
        WHERE id = $1
          AND tenant_id = $2
          AND is_platform_admin = FALSE
        RETURNING id
      `,
      [userId, request.tenant.id]
    );

    if (result.rowCount !== 1) {
      return reply.code(404).send({ message: "User not found or cannot be removed" });
    }

    return { success: true };
  });

  app.get("/admin/users", { preHandler: requireAdmin }, async (request) => {
    const result = await pool.query<{
      id: string;
      email: string;
      name: string;
      wallet_balance: string;
      is_admin: boolean;
      is_banned: boolean;
      user_type: string | null;
      membership_type: string | null;
      created_at: string;
    }>(
      `
        SELECT id, email, name, wallet_balance, is_admin, is_banned, user_type, membership_type, created_at
        FROM users
        WHERE tenant_id = $1
        ORDER BY created_at ASC
      `,
      [request.tenant.id]
    );

    return { users: result.rows };
  });

  app.get("/admin/contests", { preHandler: requireAdmin }, async (request) => {
    const result = await pool.query<{
      id: string;
      title: string;
      status: string;
      member_count: number;
      starts_at: string;
      prize_pool: string;
      question_count: string;
    }>(
      `
        SELECT
          id,
          title,
          status,
          member_count,
          starts_at,
          (member_count * entry_fee)::numeric(12, 2) AS prize_pool,
          (
            SELECT COUNT(*)::text
            FROM questions q
            WHERE q.contest_id = contests.id
          ) AS question_count
        FROM contests
        WHERE tenant_id = $1
        ORDER BY starts_at DESC
      `,
      [request.tenant.id]
    );

    const contests = await Promise.all(
      result.rows.map(async (contest) => {
        const startJob = await contestLifecycleQueue.getJob(
          makeJobId(contestLifecycleJobNames.startContest, contest.id)
        );

        return {
          ...contest,
          start_job_status: startJob
            ? startJob.failedReason
              ? "failed"
              : startJob.processedOn
                ? "processed"
                : startJob.delay > 0
                  ? "scheduled"
                  : "waiting"
            : "missing"
        };
      })
    );

    return { contests };
  });

  app.get("/admin/wallet-requests", { preHandler: requireAdmin }, async (request) => {
    const result = await pool.query<{
      id: string;
      user_id: string;
      request_type: "add_money" | "redeem";
      amount: string;
      status: "pending" | "approved" | "rejected";
      created_at: string;
      updated_at: string;
      reviewed_at: string | null;
      reviewed_by: string | null;
      user_name: string;
      user_email: string;
    }>(
      `
        SELECT
          wr.id,
          wr.user_id,
          wr.request_type,
          wr.amount,
          wr.status,
          wr.created_at,
          wr.updated_at,
          wr.reviewed_at,
          wr.reviewed_by,
          u.name AS user_name,
          u.email AS user_email
        FROM wallet_requests wr
        INNER JOIN users u ON u.id = wr.user_id
        WHERE u.tenant_id = $1
        ORDER BY
          CASE wr.status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            ELSE 2
          END,
          wr.created_at DESC
      `,
      [request.tenant.id]
    );

    return { requests: result.rows };
  });

  app.post("/admin/contests", { preHandler: requireAdmin }, async (request) => {
    const body = contestSchema.parse(request.body);
    const result = await pool.query(
      `
        INSERT INTO contests (title, starts_at, entry_fee, max_members, prize_rule, created_by, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, title, status, entry_fee, max_members, member_count, starts_at, prize_rule
      `,
      [
        body.title.trim(),
        body.starts_at,
        body.entry_fee.toFixed(2),
        body.max_members,
        body.prize_rule,
        request.user.id,
        request.tenant.id
      ]
    );

    return { contest: result.rows[0] };
  });

  app.post("/admin/contests/:id/questions", { preHandler: requireAdmin }, async (request, reply) => {
    const contestId = String((request.params as { id: string }).id);
    const body = questionSchema.parse(request.body);

    if (!(await assertTenantContestAccess(contestId, request.tenant.id))) {
      return reply.code(404).send({ message: "Contest not found" });
    }

    try {
      const result = await pool.query(
        `
          INSERT INTO questions (
            contest_id,
            seq,
            body,
            option_a,
            option_b,
            option_c,
            option_d,
            correct_option,
            time_limit_sec
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, contest_id, seq
        `,
        [
          contestId,
          body.seq,
          body.body.trim(),
          body.option_a.trim(),
          body.option_b.trim(),
          body.option_c.trim(),
          body.option_d.trim(),
          body.correct_option,
          body.time_limit_sec
        ]
      );

      return { question: result.rows[0] };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505") {
        return reply.code(409).send({ message: "Question sequence already exists" });
      }

      throw error;
    }
  });

  app.post("/admin/contests/:id/publish", { preHandler: requireAdmin }, async (request, reply) => {
    const contestId = String((request.params as { id: string }).id);

    const contestResult = await pool.query<{
      status: string;
      starts_at: string;
    }>(
      "SELECT status, starts_at FROM contests WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [contestId, request.tenant.id]
    );

    if (contestResult.rowCount !== 1) {
      return reply.code(404).send({ message: "Contest not found" });
    }

    const questionCountResult = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM questions WHERE contest_id = $1",
      [contestId]
    );

    const contest = contestResult.rows[0];
    const questionCount = Number(questionCountResult.rows[0].count);

    if (contest.status !== "draft" || questionCount < 1 || new Date(contest.starts_at).getTime() <= Date.now()) {
      return reply.code(422).send({
        message: "Contest must be draft, have at least one question, and start in the future"
      });
    }

    await pool.query("UPDATE contests SET status = 'open', updated_at = NOW() WHERE id = $1", [contestId]);

    const delay = Math.max(0, new Date(contest.starts_at).getTime() - Date.now());
    await contestLifecycleQueue.add(
      contestLifecycleJobNames.startContest,
      { contestId, tenantId: request.tenant.id },
      {
        jobId: makeJobId(contestLifecycleJobNames.startContest, contestId),
        delay
      }
    );

    return { success: true };
  });

  app.post("/admin/users/:id/wallet/credit", { preHandler: requireAdmin }, async (request, reply) => {
    const userId = String((request.params as { id: string }).id);
    const body = amountSchema.parse(request.body);

    // Verify target user belongs to the same tenant.
    const userCheck = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [userId, request.tenant.id]
    );

    if (userCheck.rowCount !== 1) {
      return reply.code(404).send({ message: "User not found" });
    }

    const result = await withTransaction(async (client) =>
      mutateWalletBalance(client, {
        userId,
        amountPaise: Math.round(body.amount * 100),
        type: "credit",
        reason: "topup",
        metadata: {
          creditedByAdminId: request.user.id
        }
      })
    );

    return {
      success: true,
      wallet_balance: (result.balanceAfterPaise / 100).toFixed(2)
    };
  });

  app.post("/admin/wallet-requests/:id/review", { preHandler: requireAdmin }, async (request, reply) => {
    const requestId = String((request.params as { id: string }).id);
    const body = walletRequestDecisionSchema.parse(request.body);

    const result = await withTransaction(async (client) => {
      const requestResult = await client.query<{
        id: string;
        user_id: string;
        request_type: "add_money" | "redeem";
        amount: string;
        status: "pending" | "approved" | "rejected";
        user_name: string;
      }>(
        `
          SELECT wr.id, wr.user_id, wr.request_type, wr.amount, wr.status, u.name AS user_name
          FROM wallet_requests wr
          INNER JOIN users u ON u.id = wr.user_id
          WHERE wr.id = $1
            AND u.tenant_id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [requestId, request.tenant.id]
      );

      if (requestResult.rowCount !== 1) {
        return reply.code(404).send({ message: "Wallet request not found" });
      }

      const walletRequest = requestResult.rows[0];

      if (walletRequest.status !== "pending") {
        return reply.code(409).send({ message: "Wallet request has already been reviewed" });
      }

      if (body.status === "approved") {
        const walletMutation = await mutateWalletBalance(client, {
          userId: walletRequest.user_id,
          amountPaise: Math.round(Number(walletRequest.amount) * 100),
          type: walletRequest.request_type === "add_money" ? "credit" : "debit",
          reason: walletRequest.request_type === "add_money" ? "topup" : "redeem",
          referenceId: walletRequest.id,
          metadata: {
            source: "wallet_request",
            approvedByAdminId: request.user.id,
            requestId: walletRequest.id,
            requestType: walletRequest.request_type
          }
        });

        await client.query(
          `
            UPDATE wallet_requests
            SET
              status = 'approved',
              reviewed_at = NOW(),
              reviewed_by = $2,
              updated_at = NOW()
            WHERE id = $1
          `,
          [requestId, request.user.id]
        );

        return {
          success: true,
          status: "approved" as const,
          request_id: requestId,
          user_name: walletRequest.user_name,
          wallet_balance: (walletMutation.balanceAfterPaise / 100).toFixed(2)
        };
      }

      await client.query(
        `
          UPDATE wallet_requests
          SET
            status = 'rejected',
            reviewed_at = NOW(),
            reviewed_by = $2,
            updated_at = NOW()
          WHERE id = $1
        `,
        [requestId, request.user.id]
      );

      return {
        success: true,
        status: "rejected" as const,
        request_id: requestId,
        user_name: walletRequest.user_name
      };
    });

    return result;
  });

  app.get("/admin/jobs", { preHandler: requireAdmin }, async (request) => {
    const states: Array<"active" | "delayed" | "waiting" | "failed"> = [
      "active",
      "delayed",
      "waiting",
      "failed"
    ];
    const queues = [
      { name: CONTEST_LIFECYCLE_QUEUE, queue: getQueueByName(CONTEST_LIFECYCLE_QUEUE) },
      { name: PAYOUTS_QUEUE, queue: getQueueByName(PAYOUTS_QUEUE) }
    ];

    const jobsByQueue = await Promise.all(
      queues.map(async ({ name, queue }) => {
        const jobs = await queue.getJobs(states);
        return jobs.map((job) => ({
          job_id: job.id,
          queue: name,
          job_name: job.name,
          data: job.data,
          status: job.failedReason
            ? "failed"
            : job.processedOn
              ? "active"
              : job.delay > 0
                ? "delayed"
                : "waiting",
          attempts: job.attemptsMade,
          failed_reason: job.failedReason ?? null,
          scheduled_for: new Date(job.timestamp + job.delay).toISOString()
        }));
      })
    );

    const allJobs = jobsByQueue.flat();
    const tenantContestIds = new Set(
      (
        await pool.query<{ id: string }>("SELECT id FROM contests WHERE tenant_id = $1", [
          request.tenant.id
        ])
      ).rows.map((row) => row.id)
    );
    const tenantUserIds = new Set(
      (
        await pool.query<{ id: string }>("SELECT id FROM users WHERE tenant_id = $1", [
          request.tenant.id
        ])
      ).rows.map((row) => row.id)
    );

    const jobs = allJobs.filter((job) => {
      const data = (job.data ?? {}) as unknown as Record<string, unknown>;
      const contestId =
        typeof data.contestId === "string"
          ? data.contestId
          : typeof data.contest_id === "string"
            ? data.contest_id
            : null;
      const userId =
        typeof data.userId === "string"
          ? data.userId
          : typeof data.user_id === "string"
            ? data.user_id
            : null;

      if (contestId) {
        return tenantContestIds.has(contestId);
      }

      if (userId) {
        return tenantUserIds.has(userId);
      }

      return false;
    });

    return { jobs };
  });

  app.post("/admin/jobs/:queue/:jobId/retry", { preHandler: requireAdmin }, async (request, reply) => {
    const { queue: queueName, jobId } = request.params as { queue: string; jobId: string };
    const queue = getQueueByName(queueName);
    const job = await queue.getJob(jobId);

    if (job) {
      const data = (job.data ?? {}) as unknown as Record<string, unknown>;
      const existingContestId = typeof data.contestId === "string" ? data.contestId : null;
      const existingUserId = typeof data.userId === "string" ? data.userId : null;

      if (existingContestId && !(await assertTenantContestAccess(existingContestId, request.tenant.id))) {
        return reply.code(404).send({ message: "Contest not found" });
      }

      if (existingUserId) {
        const userResult = await pool.query<{ id: string }>(
          "SELECT id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1",
          [existingUserId, request.tenant.id]
        );

        if (userResult.rowCount !== 1) {
          return reply.code(404).send({ message: "Payout job target not found" });
        }
      }

      if (job.failedReason) {
        await job.retry();
        return { success: true, mode: "retried_failed_job" };
      }

      return { success: true, mode: "job_already_exists" };
    }

    const [jobName, contestId, seq] = jobId.split("__");

    if (!jobName || !contestId) {
      return reply.code(400).send({ message: "Invalid job id format" });
    }

    if (queueName === CONTEST_LIFECYCLE_QUEUE) {
      if (!(await assertTenantContestAccess(contestId, request.tenant.id))) {
        return reply.code(404).send({ message: "Contest not found" });
      }
    }

    if (queueName === CONTEST_LIFECYCLE_QUEUE) {
      await contestLifecycleQueue.add(
        jobName,
        { contestId, tenantId: request.tenant.id, seq: seq ? Number(seq) : undefined },
        { jobId }
      );

      return { success: true, mode: "recreated_missing_job" };
    }

    if (queueName === PAYOUTS_QUEUE) {
      const userId = seq;

      if (!userId) {
        return reply.code(400).send({ message: "Missing payout job user id" });
      }

      if (jobName !== "prize-credit" && jobName !== "refund") {
        return reply.code(400).send({ message: "Unsupported payout job name" });
      }

      const payoutAccess = await pool.query<{ id: string }>(
        `
          SELECT u.id
          FROM users u
          JOIN contest_members cm ON cm.user_id = u.id
          JOIN contests c ON c.id = cm.contest_id
          WHERE u.id = $1
            AND c.id = $2
            AND c.tenant_id = $3
          LIMIT 1
        `,
        [userId, contestId, request.tenant.id]
      );

      if (payoutAccess.rowCount !== 1) {
        return reply.code(404).send({ message: "Payout job target not found" });
      }

      await payoutsQueue.add(
        jobName,
        { contestId, tenantId: request.tenant.id, userId },
        { jobId }
      );
      return { success: true, mode: "recreated_missing_job" };
    }

    return reply.code(400).send({ message: "Unsupported queue for retry" });
  });

  app.post("/admin/contests/:id/rebuild-cache", { preHandler: requireAdmin }, async (request, reply) => {
    const contestId = String((request.params as { id: string }).id);
    if (!(await assertTenantContestAccess(contestId, request.tenant.id))) {
      return reply.code(404).send({ message: "Contest not found" });
    }
    return rebuildContestCache(contestId);
  });

  app.post("/admin/contests/:id/recover", { preHandler: requireAdmin }, async (request, reply) => {
    const contestId = String((request.params as { id: string }).id);
    if (!(await assertTenantContestAccess(contestId, request.tenant.id))) {
      return reply.code(404).send({ message: "Contest not found" });
    }
    const cache = await rebuildContestCache(contestId);
    const jobs = await ensureContestJobs(contestId);

    return {
      success: true,
      cache,
      jobs
    };
  });
}
