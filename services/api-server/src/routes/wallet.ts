import { mutateWalletBalance, withTransaction } from "@quiz-app/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticate } from "../lib/auth.js";

const walletAmountSchema = z.object({
  amount: z.number().positive().max(100000)
});

const walletActionSchema = walletAmountSchema.extend({
  holder_name: z.string().min(2).max(120),
  bank_name: z.string().min(2).max(120),
  account_number: z.string().min(6).max(40)
});

export async function walletRoutes(app: FastifyInstance) {
  app.get("/wallet/balance", { preHandler: authenticate }, async (request) => ({
    wallet_balance: request.user.wallet_balance
  }));

  app.get("/wallet/ledger", { preHandler: authenticate }, async (request) => {
    const result = await withTransaction(async (client) =>
      client.query<{
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
      )
    );

    return { ledger: result.rows };
  });

  app.post("/wallet/add-money", { preHandler: authenticate }, async (request) => {
    const body = walletAmountSchema.parse(request.body);

    const result = await withTransaction(async (client) => {
      const requestResult = await client.query<{
        id: string;
        amount: string;
        status: "pending";
        created_at: string;
      }>(
        `
          INSERT INTO wallet_topup_requests (user_id, amount)
          VALUES ($1, $2)
          RETURNING id, amount, status, created_at
        `,
        [request.user.id, body.amount.toFixed(2)]
      );

      return requestResult.rows[0];
    });

    return {
      success: true,
      request: result,
      message: "Wallet top-up request sent to admin for approval"
    };
  });

  app.post("/wallet/redeem", { preHandler: authenticate }, async (request, reply) => {
    const body = walletActionSchema.parse(request.body);

    try {
      const result = await withTransaction(async (client) =>
        mutateWalletBalance(client, {
          userId: request.user.id,
          amountPaise: Math.round(body.amount * 100),
          type: "debit",
          reason: "redeem",
          metadata: {
            source: "temporary_redeem_button",
            holderName: body.holder_name,
            bankName: body.bank_name,
            accountNumber: body.account_number
          }
        })
      );

      return {
        success: true,
        wallet_balance: (result.balanceAfterPaise / 100).toFixed(2)
      };
    } catch (error) {
      if (error instanceof Error && error.name === "INSUFFICIENT_BALANCE") {
        return reply.code(402).send({ message: "Insufficient wallet balance" });
      }

      throw error;
    }
  });
}
