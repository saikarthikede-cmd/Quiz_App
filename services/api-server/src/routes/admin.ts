import { mutateWalletBalance, pool, withTransaction } from "@quiz-app/db";
import {
  CONTEST_LIFECYCLE_QUEUE,
  contestLifecycleJobNames,
  contestLifecycleQueue,
  getQueueByName,
  PAYOUTS_QUEUE
} from "@quiz-app/queues";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAdmin } from "../lib/auth.js";
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

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/users", { preHandler: requireAdmin }, async () => {
    const result = await pool.query<{
      id: string;
      email: string;
      name: string;
      wallet_balance: string;
      is_admin: boolean;
      is_banned: boolean;
      created_at: string;
    }>(
      `
        SELECT id, email, name, wallet_balance, is_admin, is_banned, created_at
        FROM users
        ORDER BY created_at ASC
      `
    );

    return { users: result.rows };
  });

  app.get("/admin/contests", { preHandler: requireAdmin }, async () => {
    const result = await pool.query<{
      id: string;
      title: string;
      status: string;
      member_count: number;
      starts_at: string;
      prize_pool: string;
    }>(
      `
        SELECT
          id,
          title,
          status,
          member_count,
          starts_at,
          (member_count * entry_fee)::numeric(12, 2) AS prize_pool
        FROM contests
        ORDER BY starts_at DESC
      `
    );

    return { contests: result.rows };
  });

  app.get("/admin/wallet-requests", { preHandler: requireAdmin }, async () => {
    const result = await pool.query<{
      id: string;
      user_id: string;
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
          wr.amount,
          wr.status,
          wr.created_at,
          wr.updated_at,
          wr.reviewed_at,
          wr.reviewed_by,
          u.name AS user_name,
          u.email AS user_email
        FROM wallet_topup_requests wr
        INNER JOIN users u ON u.id = wr.user_id
        ORDER BY
          CASE wr.status
            WHEN 'pending' THEN 0
            WHEN 'approved' THEN 1
            ELSE 2
          END,
          wr.created_at DESC
      `
    );

    return { requests: result.rows };
  });

  app.post("/admin/contests", { preHandler: requireAdmin }, async (request) => {
    const body = contestSchema.parse(request.body);
    const result = await pool.query(
      `
        INSERT INTO contests (title, starts_at, entry_fee, max_members, prize_rule, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, title, status, entry_fee, max_members, member_count, starts_at, prize_rule
      `,
      [
        body.title.trim(),
        body.starts_at,
        body.entry_fee.toFixed(2),
        body.max_members,
        body.prize_rule,
        request.user.id
      ]
    );

    return { contest: result.rows[0] };
  });

  app.post("/admin/contests/:id/questions", { preHandler: requireAdmin }, async (request, reply) => {
    const contestId = String((request.params as { id: string }).id);
    const body = questionSchema.parse(request.body);

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
      "SELECT status, starts_at FROM contests WHERE id = $1 LIMIT 1",
      [contestId]
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
      { contestId },
      {
        jobId: makeJobId(contestLifecycleJobNames.startContest, contestId),
        delay
      }
    );

    return { success: true };
  });

  app.post("/admin/users/:id/wallet/credit", { preHandler: requireAdmin }, async (request) => {
    const userId = String((request.params as { id: string }).id);
    const body = amountSchema.parse(request.body);

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
        amount: string;
        status: "pending" | "approved" | "rejected";
        user_name: string;
      }>(
        `
          SELECT wr.id, wr.user_id, wr.amount, wr.status, u.name AS user_name
          FROM wallet_topup_requests wr
          INNER JOIN users u ON u.id = wr.user_id
          WHERE wr.id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [requestId]
      );

      if (requestResult.rowCount !== 1) {
        return reply.code(404).send({ message: "Wallet request not found" });
      }

      const topupRequest = requestResult.rows[0];

      if (topupRequest.status !== "pending") {
        return reply.code(409).send({ message: "Wallet request has already been reviewed" });
      }

      if (body.status === "approved") {
        const walletMutation = await mutateWalletBalance(client, {
          userId: topupRequest.user_id,
          amountPaise: Math.round(Number(topupRequest.amount) * 100),
          type: "credit",
          reason: "topup",
          referenceId: topupRequest.id,
          metadata: {
            source: "wallet_topup_request",
            approvedByAdminId: request.user.id,
            requestId: topupRequest.id
          }
        });

        await client.query(
          `
            UPDATE wallet_topup_requests
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
          user_name: topupRequest.user_name,
          wallet_balance: (walletMutation.balanceAfterPaise / 100).toFixed(2)
        };
      }

      await client.query(
        `
          UPDATE wallet_topup_requests
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
        user_name: topupRequest.user_name
      };
    });

    return result;
  });

  app.get("/admin/jobs", { preHandler: requireAdmin }, async () => {
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

    return { jobs: jobsByQueue.flat() };
  });

  app.post("/admin/jobs/:queue/:jobId/retry", { preHandler: requireAdmin }, async (request, reply) => {
    const { queue: queueName, jobId } = request.params as { queue: string; jobId: string };
    const queue = getQueueByName(queueName);
    const job = await queue.getJob(jobId);

    if (job) {
      if (job.failedReason) {
        await job.retry();
        return { success: true, mode: "retried_failed_job" };
      }

      return { success: true, mode: "job_already_exists" };
    }

    if (queueName !== CONTEST_LIFECYCLE_QUEUE) {
      return reply.code(404).send({ message: "Missing payout job cannot be reconstructed automatically" });
    }

    const [jobName, contestId, seq] = jobId.split("__");

    if (!jobName || !contestId) {
      return reply.code(400).send({ message: "Invalid job id format" });
    }

    await queue.add(
      jobName,
      { contestId, seq: seq ? Number(seq) : undefined },
      { jobId }
    );

    return { success: true, mode: "recreated_missing_job" };
  });

  app.post("/admin/contests/:id/rebuild-cache", { preHandler: requireAdmin }, async (request) => {
    const contestId = String((request.params as { id: string }).id);
    return rebuildContestCache(contestId);
  });

  app.post("/admin/contests/:id/recover", { preHandler: requireAdmin }, async (request) => {
    const contestId = String((request.params as { id: string }).id);
    const cache = await rebuildContestCache(contestId);
    const jobs = await ensureContestJobs(contestId);

    return {
      success: true,
      cache,
      jobs
    };
  });
}
