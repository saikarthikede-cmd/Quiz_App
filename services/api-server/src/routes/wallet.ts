import { mutateWalletBalance, withTransaction } from "@quiz-app/db";
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

  app.post("/wallet/add-money", { preHandler: authenticate }, async (request) => {
    const body = walletAmountSchema.parse(request.body);

    // TEMPORARY PAYMENT NOTE:
    // This self-serve add-money endpoint exists only because a real payment gateway
    // is not available yet. Replace this endpoint when Razorpay or another provider
    // is integrated later.
    const result = await withTransaction(async (client) =>
      mutateWalletBalance(client, {
        userId: request.user.id,
        amountPaise: Math.round(body.amount * 100),
        type: "credit",
        reason: "manual_topup",
        metadata: {
          source: "temporary_add_money_button"
        }
      })
    );

    return {
      success: true,
      wallet_balance: (result.balanceAfterPaise / 100).toFixed(2)
    };
  });
}
