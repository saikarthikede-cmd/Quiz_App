import { pool, withTransaction } from "@quiz-app/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticate } from "../lib/auth.js";

const walletAmountSchema = z.object({
  amount: z.number().positive().max(100000)
});

export async function walletRoutes(app: FastifyInstance) {
  app.get("/wallet/balance", { preHandler: authenticate }, async (request) => ({
    wallet_balance: request.user.wallet_balance
  }));

  app.get("/users/ranking", async (request) => {
    const result = await pool.query<{
      user_id: string;
      name: string;
      rank: string;
    }>(
      `
        SELECT
          id AS user_id,
          name,
          DENSE_RANK() OVER (ORDER BY wallet_balance::numeric DESC, created_at ASC) ::text AS rank
        FROM users
        WHERE tenant_id = $1
        ORDER BY wallet_balance::numeric DESC, created_at ASC
        LIMIT 10
      `,
      [request.tenant.id]
    );

    return {
      ranking: result.rows
    };
  });

  app.get("/wallet/ledger", { preHandler: authenticate }, async (request) => {
    const result = await pool.query<{
      id: string;
      type: string;
      reason: string;
      amount: string;
      balance_before: string;
      balance_after: string;
      reference_id: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(
      `
        SELECT
          id,
          type,
          reason,
          amount,
          balance_before,
          balance_after,
          reference_id,
          metadata,
          created_at
        FROM wallet_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [request.user.id]
    );

    return { ledger: result.rows };
  });

  app.post("/wallet/add-money", { preHandler: authenticate }, async (request) => {
    const body = walletAmountSchema.parse(request.body);

    const result = await withTransaction(async (client) => {
      const requestResult = await client.query<{
        id: string;
        request_type: "add_money";
        amount: string;
        status: "pending";
        created_at: string;
      }>(
        `
          INSERT INTO wallet_requests (user_id, company_id, request_type, amount)
          VALUES ($1, $2, 'add_money', $3)
          RETURNING id, request_type, amount, status, created_at
        `,
        [request.user.id, request.tenant.id, body.amount.toFixed(2)]
      );

      return requestResult.rows[0];
    });

    return {
      success: true,
      request: result,
      message: "Wallet top-up request sent to admin for approval"
    };
  });

  app.post("/wallet/redeem", { preHandler: authenticate }, async (request) => {
    const body = walletAmountSchema.parse(request.body);

    const result = await withTransaction(async (client) => {
      const requestResult = await client.query<{
        id: string;
        request_type: "redeem";
        amount: string;
        status: "pending";
        created_at: string;
      }>(
        `
          INSERT INTO wallet_requests (user_id, company_id, request_type, amount)
          VALUES ($1, $2, 'redeem', $3)
          RETURNING id, request_type, amount, status, created_at
        `,
        [request.user.id, request.tenant.id, body.amount.toFixed(2)]
      );

      return requestResult.rows[0];
    });

    return {
      success: true,
      request: result,
      message: "Redeem request sent to admin for approval"
    };
  });
}
