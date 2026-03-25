import { withTransaction } from "@quiz-app/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { config } from "../env.js";
import {
  authenticate,
  clearRefreshCookie,
  createSession,
  getRefreshCookieName,
  refreshSession,
  revokeRefreshToken,
  setRefreshCookie
} from "../lib/auth.js";

const devLoginSchema = z.object({
  email: z.email(),
  name: z.string().min(2).max(80).optional(),
  avatar_url: z.url().optional()
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/dev-login", async (request, reply) => {
    const body = devLoginSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();

    // TEMPORARY AUTH NOTE:
    // Real Google OAuth is intentionally deferred because company OAuth credentials
    // are not available yet. This route accepts a real email address, creates or
    // reuses the user, and issues the same JWT/refresh-token session shape so the
    // backend can be completed now and Google can be swapped in later.
    const result = await withTransaction(async (client) => {
      const existingUser = await client.query<{
        id: string;
        email: string;
        name: string;
        avatar_url: string | null;
        wallet_balance: string;
        is_admin: boolean;
        is_banned: boolean;
      }>(
        `
          SELECT id, email, name, avatar_url, wallet_balance, is_admin, is_banned
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
        [email]
      );

      const user =
        existingUser.rows[0] ??
        (
          await client.query<{
            id: string;
            email: string;
            name: string;
            avatar_url: string | null;
            wallet_balance: string;
            is_admin: boolean;
            is_banned: boolean;
          }>(
            `
              INSERT INTO users (email, name, avatar_url, is_admin)
              VALUES ($1, $2, $3, $4)
              RETURNING id, email, name, avatar_url, wallet_balance, is_admin, is_banned
            `,
            [
              email,
              body.name?.trim() || email.split("@")[0],
              body.avatar_url ?? null,
              email === config.adminEmail
            ]
          )
        ).rows[0];

      if (user.is_banned) {
        return reply.code(403).send({ message: "User account is banned" });
      }

      const session = await createSession({
        id: user.id,
        email: user.email,
        is_admin: user.is_admin,
        is_banned: user.is_banned
      });

      return { user, session };
    });

    if (!result || "statusCode" in result) {
      return result;
    }

    setRefreshCookie(reply, result.session.refreshToken);

    return {
      access_token: result.session.accessToken,
      user: result.user,
      mode: "temporary_email_auth",
      comment:
        "Temporary email auth is enabled because Google OAuth credentials are unavailable."
    };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const rawRefreshToken = request.cookies[getRefreshCookieName()];

    if (!rawRefreshToken) {
      return reply.code(401).send({ message: "Missing refresh token cookie" });
    }

    const nextSession = await refreshSession(rawRefreshToken);

    if (!nextSession) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ message: "Refresh token is invalid or expired" });
    }

    setRefreshCookie(reply, nextSession.refreshToken);

    return {
      access_token: nextSession.accessToken
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const rawRefreshToken = request.cookies[getRefreshCookieName()];

    if (rawRefreshToken) {
      await revokeRefreshToken(rawRefreshToken);
    }

    clearRefreshCookie(reply);
    return { success: true };
  });

  app.get("/auth/me", { preHandler: authenticate }, async (request) => ({
    user: request.user
  }));
}
