import { pool, withTransaction } from "@quiz-app/db";
import type { FastifyInstance } from "fastify";
import { OAuth2Client } from "google-auth-library";
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
import { generateOtpCode, hashOtpCode, isAllowedOtpEmail } from "../lib/otp.js";

const devLoginSchema = z.object({
  email: z.email(),
  name: z.string().min(2).max(80).optional(),
  avatar_url: z.url().optional()
});

const requestOtpSchema = z.object({
  email: z.email(),
  name: z.string().min(2).max(80).optional(),
  avatar_url: z.url().optional()
});

const verifyOtpSchema = z.object({
  email: z.email(),
  otp: z.string().regex(/^\d{6}$/)
});

const googleLoginSchema = z.object({
  id_token: z.string().min(20)
});

type AuthIdentityInput = z.infer<typeof requestOtpSchema>;
type DbClient = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  wallet_balance: string;
  is_admin: boolean;
  is_banned: boolean;
};

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

async function findOrCreateUser(
  client: DbClient,
  body: AuthIdentityInput,
  email: string
) {
  const existingUser = await client.query<UserRow>(
    `
      SELECT id, email, name, avatar_url, wallet_balance, is_admin, is_banned
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email]
  );

  return (
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
    ).rows[0]
  );
}

async function findOrCreateGoogleUser(
  client: DbClient,
  profile: {
    providerUid: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  }
) {
  const linkedAccount = await client.query<UserRow>(
    `
      SELECT u.id, u.email, u.name, u.avatar_url, u.wallet_balance, u.is_admin, u.is_banned
      FROM oauth_accounts oa
      INNER JOIN users u ON u.id = oa.user_id
      WHERE oa.provider = 'google'
        AND oa.provider_uid = $1
      LIMIT 1
    `,
    [profile.providerUid]
  );

  if (linkedAccount.rowCount === 1) {
    return linkedAccount.rows[0];
  }

  const existingUser = await client.query<UserRow>(
    `
      SELECT id, email, name, avatar_url, wallet_balance, is_admin, is_banned
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [profile.email]
  );

  if (existingUser.rowCount === 1) {
    const user = existingUser.rows[0];

    await client.query(
      `
        INSERT INTO oauth_accounts (user_id, provider, provider_uid, email)
        VALUES ($1, 'google', $2, $3)
        ON CONFLICT (provider, provider_uid) DO NOTHING
      `,
      [user.id, profile.providerUid, profile.email]
    );

    return user;
  }

  const createdUser = await client.query<UserRow>(
    `
      INSERT INTO users (email, name, avatar_url, is_admin)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, name, avatar_url, wallet_balance, is_admin, is_banned
    `,
    [profile.email, profile.name, profile.avatarUrl, profile.email === config.adminEmail]
  );

  const user = createdUser.rows[0];

  await client.query(
    `
      INSERT INTO oauth_accounts (user_id, provider, provider_uid, email)
      VALUES ($1, 'google', $2, $3)
    `,
    [user.id, profile.providerUid, profile.email]
  );

  return user;
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/google/config", async () => ({
    enabled: Boolean(config.googleClientId),
    client_id: config.googleClientId || null
  }));

  app.post("/auth/google", async (request, reply) => {
    if (!googleClient || !config.googleClientId) {
      return reply.code(503).send({ message: "Google sign-in is not configured yet" });
    }

    const body = googleLoginSchema.parse(request.body);
    let payload:
      | {
          sub?: string;
          email?: string;
          email_verified?: boolean;
          name?: string;
          picture?: string;
        }
      | undefined;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: body.id_token,
        audience: config.googleClientId
      });
      payload = ticket.getPayload();
    } catch {
      return reply.code(401).send({ message: "Google account verification failed" });
    }

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      return reply.code(401).send({ message: "Google account verification failed" });
    }

    const providerUid = payload.sub;
    const email = payload.email.trim().toLowerCase();
    const result = await withTransaction(async (client) => {
      const user = await findOrCreateGoogleUser(client, {
        providerUid,
        email,
        name: payload.name?.trim() || email.split("@")[0],
        avatarUrl: payload.picture ?? null
      });

      if (user.is_banned) {
        return reply.code(403).send({ message: "User account is banned" });
      }

      const session = await createSession(
        {
          id: user.id,
          email: user.email,
          is_admin: user.is_admin,
          is_banned: user.is_banned
        },
        client
      );

      return { user, session };
    });

    if (!result || "statusCode" in result) {
      return result;
    }

    setRefreshCookie(reply, result.session.refreshToken);

    return {
      access_token: result.session.accessToken,
      user: result.user,
      mode: "google_oauth"
    };
  });

  app.post("/auth/dev-login", async (request, reply) => {
    const body = devLoginSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();

    // TEMPORARY AUTH NOTE:
    // Real Google OAuth is intentionally deferred because company OAuth credentials
    // are not available yet. This route accepts a real email address, creates or
    // reuses the user, and issues the same JWT/refresh-token session shape so the
    // backend can be completed now and Google can be swapped in later.
    const result = await withTransaction(async (client) => {
      const user = await findOrCreateUser(client, body, email);

      if (user.is_banned) {
        return reply.code(403).send({ message: "User account is banned" });
      }

      const session = await createSession(
        {
          id: user.id,
          email: user.email,
          is_admin: user.is_admin,
          is_banned: user.is_banned
        },
        client
      );

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

  app.post("/auth/request-otp", async (request, reply) => {
    const body = requestOtpSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();

    if (!isAllowedOtpEmail(email)) {
      return reply.code(403).send({
        message: "This email is not allowed for OTP login in the current environment"
      });
    }

    const otp = generateOtpCode();
    const codeHash = hashOtpCode(email, otp);
    const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60 * 1000);

    const existingUser = await pool.query<{
      is_banned: boolean;
    }>(
      `
        SELECT is_banned
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

    if (existingUser.rowCount === 1 && existingUser.rows[0].is_banned) {
      return reply.code(403).send({ message: "User account is banned" });
    }

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE auth_otps
          SET consumed_at = NOW()
          WHERE email = $1
            AND consumed_at IS NULL
        `,
        [email]
      );

      await client.query(
        `
          INSERT INTO auth_otps (
            email,
            code_hash,
            requested_name,
            requested_avatar_url,
            expires_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [
          email,
          codeHash,
          body.name?.trim() ?? null,
          body.avatar_url ?? null,
          expiresAt,
          JSON.stringify({
            delivery_mode: config.otpDeliveryMode
          })
        ]
      );
    });

    request.log.info(
      {
        email,
        otp,
        expiresAt: expiresAt.toISOString(),
        deliveryMode: config.otpDeliveryMode
      },
      "OTP generated for sign-in"
    );

    return {
      success: true,
      mode: "otp_request",
      delivery: config.otpDeliveryMode,
      expires_in_seconds: config.otpTtlMinutes * 60,
      comment:
        config.otpDeliveryMode === "server_log"
          ? "OTP is currently written to the API server log because no email provider is configured yet."
          : "OTP delivery is configured outside the app.",
      ...(config.otpExposeInResponse ? { dev_otp: otp } : {})
    };
  });

  app.post("/auth/verify-otp", async (request, reply) => {
    const body = verifyOtpSchema.parse(request.body);
    const email = body.email.trim().toLowerCase();
    const otpHash = hashOtpCode(email, body.otp);

    const result = await withTransaction(async (client) => {
      const otpResult = await client.query<{
        id: string;
        attempts: number;
        requested_name: string | null;
        requested_avatar_url: string | null;
      }>(
        `
          SELECT id, attempts, requested_name, requested_avatar_url
          FROM auth_otps
          WHERE email = $1
            AND consumed_at IS NULL
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [email]
      );

      if (otpResult.rowCount !== 1) {
        return reply.code(401).send({ message: "OTP is invalid or expired. Request a new code." });
      }

      const otpRow = otpResult.rows[0];
      const nextAttempts = otpRow.attempts + 1;

      const matchResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM auth_otps
          WHERE id = $1
            AND code_hash = $2
            AND consumed_at IS NULL
            AND expires_at > NOW()
          LIMIT 1
        `,
        [otpRow.id, otpHash]
      );

      if (matchResult.rowCount !== 1) {
        await client.query(
          `
            UPDATE auth_otps
            SET
              attempts = $2,
              last_attempt_at = NOW(),
              consumed_at = CASE WHEN $2 >= $3 THEN NOW() ELSE consumed_at END
            WHERE id = $1
          `,
          [otpRow.id, nextAttempts, config.otpMaxAttempts]
        );

        if (nextAttempts >= config.otpMaxAttempts) {
          return reply
            .code(429)
            .send({ message: "OTP failed too many times. Request a new code." });
        }

        return reply.code(401).send({ message: "OTP is invalid or expired. Request a new code." });
      }

      await client.query(
        `
          UPDATE auth_otps
          SET attempts = $2, last_attempt_at = NOW(), consumed_at = NOW()
          WHERE id = $1
        `,
        [otpRow.id, nextAttempts]
      );

      const user = await findOrCreateUser(
        client,
        {
          email,
          name: otpRow.requested_name ?? undefined,
          avatar_url: otpRow.requested_avatar_url ?? undefined
        },
        email
      );

      if (user.is_banned) {
        return reply.code(403).send({ message: "User account is banned" });
      }

      const session = await createSession(
        {
          id: user.id,
          email: user.email,
          is_admin: user.is_admin,
          is_banned: user.is_banned
        },
        client
      );

      return { user, session };
    });

    if (!result || "statusCode" in result) {
      return result;
    }

    setRefreshCookie(reply, result.session.refreshToken);

    return {
      access_token: result.session.accessToken,
      user: result.user,
      mode: "otp_auth",
      comment:
        "OTP login is active. Configure email delivery later to send codes to inboxes instead of server logs."
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
