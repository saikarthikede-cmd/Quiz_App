import {
  moneyToPaise,
  mutateWalletBalance,
  paiseToMoney,
  pool,
  withTransaction
} from "@quiz-app/db";
import { contestChannel, contestMembersKey, runRedisWithRetry } from "@quiz-app/redis";
import type { FastifyInstance } from "fastify";

import { authenticate } from "../lib/auth.js";
import { redis } from "../lib/redis.js";

export async function contestRoutes(app: FastifyInstance) {
  app.get("/contests", async () => {
    const result = await pool.query<{
      id: string;
      title: string;
      entry_fee: string;
      max_members: number;
      member_count: number;
      starts_at: string;
      prize_pool: string;
    }>(
      `
        SELECT
          id,
          title,
          entry_fee,
          max_members,
          member_count,
          starts_at,
          (member_count * entry_fee)::numeric(12, 2) AS prize_pool
        FROM contests
        WHERE status = 'open'
          AND member_count < max_members
        ORDER BY starts_at ASC
      `
    );

    return { contests: result.rows };
  });

  app.post("/contests/:id/join", { preHandler: authenticate }, async (request, reply) => {
    const contestId = String((request.params as { id: string }).id);

    try {
      const joined = await withTransaction(async (client) => {
        const contestResult = await client.query<{
          id: string;
          title: string;
          status: string;
          entry_fee: string;
          max_members: number;
          member_count: number;
        }>(
          `
            SELECT id, title, status, entry_fee, max_members, member_count
            FROM contests
            WHERE id = $1
            FOR UPDATE
          `,
          [contestId]
        );

        if (contestResult.rowCount !== 1) {
          return reply.code(404).send({ message: "Contest not found" });
        }

        const contest = contestResult.rows[0];

        if (contest.status !== "open" || contest.member_count >= contest.max_members) {
          return reply.code(409).send({ message: "Contest is not open for joining" });
        }

        const existingMember = await client.query(
          "SELECT 1 FROM contest_members WHERE contest_id = $1 AND user_id = $2 LIMIT 1",
          [contestId, request.user.id]
        );

        if ((existingMember.rowCount ?? 0) > 0) {
          return reply.code(409).send({ message: "User already joined this contest" });
        }

        const entryFeePaise = moneyToPaise(contest.entry_fee);
        const walletResult = await mutateWalletBalance(client, {
          userId: request.user.id,
          amountPaise: entryFeePaise,
          type: "debit",
          reason: "entry_fee",
          referenceId: contestId,
          metadata: {
            contestId,
            contestTitle: contest.title
          }
        });

        await client.query(
          "INSERT INTO contest_members (contest_id, user_id) VALUES ($1, $2)",
          [contestId, request.user.id]
        );
        await client.query(
          "UPDATE contests SET member_count = member_count + 1, updated_at = NOW() WHERE id = $1",
          [contestId]
        );

        return {
          contestId,
          memberCount: contest.member_count + 1,
          prizePool: paiseToMoney((contest.member_count + 1) * entryFeePaise),
          walletBalance: paiseToMoney(walletResult.balanceAfterPaise)
        };
      });

      if (!joined || "statusCode" in joined) {
        return joined;
      }

      try {
        await runRedisWithRetry(() => redis.sadd(contestMembersKey(contestId), request.user.id));
        await runRedisWithRetry(() =>
          redis.publish(
            contestChannel(contestId),
            JSON.stringify({
              type: "lobby_update",
              contest_id: contestId,
              member_count: joined.memberCount,
              prize_pool: joined.prizePool
            })
          )
        );
      } catch (redisError) {
        request.log.error({ err: redisError, contestId }, "Failed to sync contest join into Redis");
      }

      return {
        success: true,
        contest_id: contestId,
        member_count: joined.memberCount,
        prize_pool: joined.prizePool,
        wallet_balance: joined.walletBalance
      };
    } catch (error) {
      if (error instanceof Error && error.name === "INSUFFICIENT_BALANCE") {
        return reply.code(402).send({ message: "Insufficient wallet balance" });
      }

      throw error;
    }
  });

  app.get("/contests/:id/leaderboard", async (request, reply) => {
    const contestId = String((request.params as { id: string }).id);
    const contestResult = await pool.query<{ status: string }>(
      "SELECT status FROM contests WHERE id = $1 LIMIT 1",
      [contestId]
    );

    if (contestResult.rowCount !== 1) {
      return reply.code(404).send({ message: "Contest not found" });
    }

    if (contestResult.rows[0].status !== "ended") {
      return reply.code(409).send({ message: "Leaderboard is available only after contest end" });
    }

    const leaderboardResult = await pool.query<{
      user_id: string;
      name: string;
      avatar_url: string | null;
      correct_count: string;
      is_winner: boolean;
      prize_amount: string;
    }>(
      `
        SELECT
          u.id AS user_id,
          u.name,
          u.avatar_url,
          COUNT(*) FILTER (WHERE a.is_correct = true)::text AS correct_count,
          cm.is_winner,
          cm.prize_amount
        FROM contest_members cm
        JOIN users u ON u.id = cm.user_id
        LEFT JOIN answers a
          ON a.contest_id = cm.contest_id
          AND a.user_id = cm.user_id
        WHERE cm.contest_id = $1
        GROUP BY u.id, u.name, u.avatar_url, cm.is_winner, cm.prize_amount, cm.joined_at
        ORDER BY
          COUNT(*) FILTER (WHERE a.is_correct = true) DESC,
          MAX(a.answered_at) ASC NULLS LAST,
          cm.joined_at ASC
      `,
      [contestId]
    );

    return { leaderboard: leaderboardResult.rows };
  });
}
