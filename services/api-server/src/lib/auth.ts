import { createHash, randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";

import { pool, withTransaction } from "@quiz-app/db";

import { config } from "../env.js";

const REFRESH_COOKIE = "quiz_refresh_token";
const jwtKey = new TextEncoder().encode(config.jwtSecret);

interface SessionUser {
  id: string;
  email: string;
  tenant_id: string;
  is_admin: boolean;
  is_platform_admin: boolean;
  is_banned: boolean;
}

type TransactionClient = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

export function getRefreshCookieName() {
  return REFRESH_COOKIE;
}

export function hashRefreshToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function issueAccessToken(user: SessionUser) {
  return new SignJWT({
    user_id: user.id,
    email: user.email,
    tenant_id: user.tenant_id,
    is_banned: user.is_banned,
    is_admin: user.is_admin,
    is_platform_admin: user.is_platform_admin
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setExpirationTime(`${config.accessTokenTtlMinutes}m`)
    .sign(jwtKey);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, jwtKey, {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience
  });

  return {
    userId: String(payload.user_id),
    tenantId: String(payload.tenant_id)
  };
}

export async function createSession(user: SessionUser, client?: TransactionClient) {
  const rawRefreshToken = randomBytes(32).toString("hex");
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  if (client) {
    await client.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, refreshTokenHash, expiresAt]
    );
  } else {
    await withTransaction(async (transactionClient) => {
      await transactionClient.query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [user.id, refreshTokenHash, expiresAt]
      );
    });
  }

  return {
    accessToken: await issueAccessToken(user),
    refreshToken: rawRefreshToken
  };
}

export async function refreshSession(rawRefreshToken: string, tenantId: string) {
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);

  return withTransaction(async (client) => {
    const tokenResult = await client.query<{
      id: string;
      user_id: string;
      expires_at: string;
      revoked_at: string | null;
      email: string;
      tenant_id: string;
      is_admin: boolean;
      is_platform_admin: boolean;
      is_banned: boolean;
    }>(
      `
        SELECT
          rt.id,
          rt.user_id,
          rt.expires_at,
          rt.revoked_at,
          u.email,
          u.tenant_id,
          u.is_admin,
          u.is_platform_admin,
          u.is_banned
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        LIMIT 1
      `,
      [refreshTokenHash]
    );

    if (tokenResult.rowCount !== 1) {
      return null;
    }

    const tokenRow = tokenResult.rows[0];

    if (tokenRow.tenant_id !== tenantId && !tokenRow.is_platform_admin) {
      return null;
    }

    if (tokenRow.revoked_at || new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return null;
    }

    const nextRawToken = randomBytes(32).toString("hex");
    const nextTokenHash = hashRefreshToken(nextRawToken);
    const nextExpiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

    await client.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1", [tokenRow.id]);
    await client.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [tokenRow.user_id, nextTokenHash, nextExpiresAt]
    );

    return {
      accessToken: await issueAccessToken({
        id: tokenRow.user_id,
        email: tokenRow.email,
        tenant_id: tokenRow.tenant_id,
        is_admin: tokenRow.is_admin,
        is_platform_admin: tokenRow.is_platform_admin,
        is_banned: tokenRow.is_banned
      }),
      refreshToken: nextRawToken
    };
  });
}

export async function revokeRefreshToken(rawRefreshToken: string) {
  const refreshTokenHash = hashRefreshToken(rawRefreshToken);
  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
    [refreshTokenHash]
  );
}

export function setRefreshCookie(reply: FastifyReply, rawRefreshToken: string) {
  reply.setCookie(REFRESH_COOKIE, rawRefreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    domain: config.cookieDomain,
    expires: new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000)
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, {
    path: "/",
    domain: config.cookieDomain
  });
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!token) {
    return reply.code(401).send({ message: "Missing Bearer token" });
  }

  try {
    const payload = await verifyAccessToken(token);
    const userResult =
      payload.tenantId === request.tenant.id
        ? await pool.query<FastifyRequest["user"]>(
            `
              SELECT
                id,
                email,
                name,
                avatar_url,
                wallet_balance,
                is_admin,
                is_platform_admin,
                is_banned,
                user_type,
                username,
                college_name,
                student_id,
                company_name,
                membership_type,
                entered_reference_id,
                onboarding_completed
              FROM users
              WHERE id = $1
                AND tenant_id = $2
              LIMIT 1
            `,
            [payload.userId, request.tenant.id]
          )
        : await pool.query<FastifyRequest["user"]>(
            `
              SELECT
                id,
                email,
                name,
                avatar_url,
                wallet_balance,
                is_admin,
                is_platform_admin,
                is_banned,
                user_type,
                username,
                college_name,
                student_id,
                company_name,
                membership_type,
                entered_reference_id,
                onboarding_completed
              FROM users
              WHERE id = $1
              LIMIT 1
            `,
            [payload.userId]
          );

    if (userResult.rowCount !== 1) {
      return reply.code(401).send({ message: "User not found" });
    }

    if (payload.tenantId !== request.tenant.id && !userResult.rows[0].is_platform_admin) {
      return reply.code(401).send({ message: "Access token does not match company context" });
    }

    if (userResult.rows[0].is_banned) {
      return reply.code(403).send({ message: "User account is banned" });
    }

    request.user = userResult.rows[0];
  } catch (error) {
    request.log.warn({ err: error }, "Access token verification failed");
    return reply.code(401).send({ message: "Invalid or expired access token" });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const authResult = await authenticate(request, reply);

  if (authResult) {
    return authResult;
  }

  if (!request.user.is_admin) {
    return reply.code(403).send({ message: "Admin access required" });
  }
}

export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply) {
  const authResult = await authenticate(request, reply);

  if (authResult) {
    return authResult;
  }

  if (!request.user.is_platform_admin) {
    return reply.code(403).send({ message: "Platform admin access required" });
  }
}
