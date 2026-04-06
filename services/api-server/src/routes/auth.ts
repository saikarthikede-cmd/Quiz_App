import { withTransaction } from "@quiz-app/db";
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

const googleLoginSchema = z.object({
  id_token: z.string().min(20)
});

type DbClient = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  wallet_balance: string;
  tenant_id: string;
  is_admin: boolean;
  is_platform_admin: boolean;
  is_banned: boolean;
  user_type: "individual" | "student" | "employee" | null;
  username: string | null;
  college_name: string | null;
  student_id: string | null;
  company_name: string | null;
  membership_type: string | null;
  entered_reference_id: string | null;
  onboarding_completed: boolean;
};

const onboardingSchema = z
  .union([
    z.object({
      user_type: z.literal("individual"),
      username: z.string().min(2).max(80)
    }),
    z.object({
      user_type: z.literal("student"),
      college_name: z.string().min(2).max(120),
      student_id: z.string().min(1).max(120)
    }),
    z.object({
      user_type: z.literal("employee"),
      company_name: z.string().min(2).max(120),
      company_id: z.string().min(1).max(120),
      request_admin_access: z.boolean().optional().default(false)
    }),
    z.object({
      role_type: z.literal("student"),
      company_name: z.string().min(2).max(120),
      company_id: z.string().min(1).max(120)
    }),
    z.object({
      role_type: z.literal("company"),
      company_name: z.string().min(2).max(120),
      company_id: z.string().min(1).max(120),
      request_admin_access: z.boolean().optional().default(false)
    })
  ])
  .transform((payload) => {
    if ("user_type" in payload) {
      return payload;
    }

    if (payload.role_type === "student") {
      return {
        user_type: "student" as const,
        college_name: payload.company_name,
        student_id: payload.company_id
      };
    }

    return {
      user_type: "employee" as const,
      company_name: payload.company_name,
      company_id: payload.company_id,
      request_admin_access: payload.request_admin_access ?? false
    };
  });

const companyReferenceQuerySchema = z
  .object({
    name: z.string().min(2).max(120),
    role_type: z.enum(["student", "company", "employee"]).optional(),
    user_type: z.enum(["student", "employee"]).optional()
  })
  .transform((query) => ({
    name: query.name,
    user_type: query.user_type ?? (query.role_type === "student" ? "student" : "employee")
  }));

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000001";

function isUniqueViolation(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "23505";
}

async function getUserByEmailAndTenant(client: DbClient, email: string, tenantId: string) {
  const result = await client.query<UserRow>(
    `
      SELECT
        id,
        email,
        name,
        avatar_url,
        wallet_balance,
        tenant_id,
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
      WHERE email = $1
        AND tenant_id = $2
      LIMIT 1
    `,
    [email, tenantId]
  );

  return result.rows[0] ?? null;
}

function pickPreferredLinkedUser(users: UserRow[], options: { isMainAdminEmail: boolean; tenantId: string }) {
  if (users.length === 0) {
    return null;
  }

  if (options.isMainAdminEmail) {
    return (
      users.find((user) => user.is_platform_admin || user.tenant_id === PLATFORM_TENANT_ID) ??
      users[0]
    );
  }

  return users.find((user) => user.onboarding_completed) ??
    users.find((user) => user.tenant_id === options.tenantId) ??
    users[0];
}

async function findOrCreateGoogleUser(
  client: DbClient,
  profile: {
    providerUid: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  },
  tenantId: string
) {
  const isMainAdminEmail = profile.email.trim().toLowerCase() === config.mainAdminEmail;
  const effectiveTenantId = isMainAdminEmail ? PLATFORM_TENANT_ID : tenantId;

  const linkedAccount = await client.query<UserRow>(
    `
      SELECT
        u.id,
        u.email,
        u.name,
        u.avatar_url,
        u.wallet_balance,
        u.tenant_id,
        u.is_admin,
        u.is_platform_admin,
        u.is_banned,
        u.user_type,
        u.username,
        u.college_name,
        u.student_id,
        u.company_name,
        u.membership_type,
        u.entered_reference_id,
        u.onboarding_completed
      FROM oauth_accounts oa
      INNER JOIN users u ON u.id = oa.user_id
      WHERE oa.provider = 'google'
        AND oa.provider_uid = $1
      ORDER BY
        CASE
          WHEN u.is_platform_admin THEN 0
          WHEN u.tenant_id = $2 THEN 1
          ELSE 2
        END,
        u.created_at ASC
    `,
    [profile.providerUid, effectiveTenantId]
  );

  if ((linkedAccount.rowCount ?? 0) >= 1) {
    const linkedUser = pickPreferredLinkedUser(linkedAccount.rows, {
      isMainAdminEmail,
      tenantId: effectiveTenantId
    });

    if (!linkedUser) {
      throw new Error("Could not resolve linked Google account");
    }

    if (isMainAdminEmail && !linkedUser.is_platform_admin) {
      const elevatedUser = await client.query<UserRow>(
        `
          UPDATE users
          SET
            tenant_id = $2,
            is_admin = TRUE,
            is_platform_admin = TRUE,
            onboarding_completed = TRUE,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            email,
            name,
            avatar_url,
            wallet_balance,
            tenant_id,
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
        `,
        [linkedUser.id, PLATFORM_TENANT_ID]
      );

      await client.query(
        `
          UPDATE oauth_accounts
          SET tenant_id = $2
          WHERE user_id = $1
        `,
        [linkedUser.id, PLATFORM_TENANT_ID]
      );

      return elevatedUser.rows[0];
    }

    return linkedUser;
  }

  const existingUser = await client.query<UserRow>(
    `
      SELECT
        id,
        email,
        name,
        avatar_url,
        wallet_balance,
        tenant_id,
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
      WHERE email = $1
      ORDER BY
        CASE
          WHEN is_platform_admin THEN 0
          WHEN onboarding_completed THEN 1
          WHEN tenant_id = $2 THEN 2
          ELSE 3
        END,
        created_at ASC
    `,
    [profile.email, effectiveTenantId]
  );

  if ((existingUser.rowCount ?? 0) >= 1) {
    const user = pickPreferredLinkedUser(existingUser.rows, {
      isMainAdminEmail,
      tenantId: effectiveTenantId
    });

    if (!user) {
      throw new Error("Could not resolve existing user");
    }

    if (isMainAdminEmail && !user.is_platform_admin) {
      const elevatedUser = await client.query<UserRow>(
        `
          UPDATE users
          SET tenant_id = $2, is_admin = TRUE, is_platform_admin = TRUE, onboarding_completed = TRUE, updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            email,
            name,
            avatar_url,
            wallet_balance,
            tenant_id,
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
        `,
        [user.id, PLATFORM_TENANT_ID]
      );

      await client.query(
        `
          INSERT INTO oauth_accounts (user_id, provider, provider_uid, email, tenant_id)
          VALUES ($1, 'google', $2, $3, $4)
          ON CONFLICT (tenant_id, provider, provider_uid) DO NOTHING
        `,
        [user.id, profile.providerUid, profile.email, PLATFORM_TENANT_ID]
      );

      return elevatedUser.rows[0];
    }

    await client.query(
      `
        INSERT INTO oauth_accounts (user_id, provider, provider_uid, email, tenant_id)
        VALUES ($1, 'google', $2, $3, $4)
        ON CONFLICT (tenant_id, provider, provider_uid) DO NOTHING
      `,
        [user.id, profile.providerUid, profile.email, user.tenant_id]
      );

    return user;
  }

  const isPlatformAdmin = isMainAdminEmail;
  const isAdmin = isMainAdminEmail;

  let user: UserRow | null = null;

  try {
    const createdUser = await client.query<UserRow>(
      `
        INSERT INTO users (email, name, avatar_url, is_admin, is_platform_admin, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          email,
          name,
          avatar_url,
          wallet_balance,
          tenant_id,
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
      `,
      [profile.email, profile.name, profile.avatarUrl, isAdmin, isPlatformAdmin, effectiveTenantId]
    );

    user = createdUser.rows[0];
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    user = await getUserByEmailAndTenant(client, profile.email, effectiveTenantId);
  }

  if (!user) {
    throw new Error("Could not resolve Google user");
  }

  await client.query(
    `
      INSERT INTO oauth_accounts (user_id, provider, provider_uid, email, tenant_id)
      VALUES ($1, 'google', $2, $3, $4)
      ON CONFLICT (tenant_id, provider, provider_uid) DO NOTHING
    `,
    [user.id, profile.providerUid, profile.email, effectiveTenantId]
  );

  return user;
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/google/config", async () => ({
    enabled: Boolean(config.googleClientId),
    client_id: config.googleClientId || null
  }));

  app.get("/auth/company-reference", async (request) => {
    const query = companyReferenceQuerySchema.parse(request.query);
    const targetCompanyType = query.user_type === "student" ? "college" : "company";

    const result = await withTransaction(async (client) => {
      const companyResult = await client.query<{
        id: string;
        slug: string;
        name: string;
        company_type: string;
        id_pattern: string | null;
      }>(
        `
          SELECT id, slug, name, company_type, id_pattern
          FROM tenants
          WHERE LOWER(name) = LOWER($1)
            AND company_type = $2
            AND is_active = TRUE
          LIMIT 2
        `,
        [query.name.trim(), targetCompanyType]
      );

      if ((companyResult.rowCount ?? 0) > 1) {
        return { exists: false as const, ambiguous: true as const };
      }

      if (companyResult.rowCount !== 1) {
        return { exists: false as const };
      }

      return {
        exists: true as const,
        company: companyResult.rows[0]
      };
    });

    return result;
  });

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
      const user = await findOrCreateGoogleUser(
        client,
        {
          providerUid,
          email,
          name: payload.name?.trim() || email.split("@")[0],
          avatarUrl: payload.picture ?? null
        },
        request.tenant.id
      );

      if (user.is_banned) {
        return reply.code(403).send({ message: "User account is banned" });
      }

      const session = await createSession(
        {
          id: user.id,
          email: user.email,
          tenant_id: user.tenant_id,
          is_admin: user.is_admin,
          is_platform_admin: user.is_platform_admin,
          is_banned: user.is_banned
        },
        client
      );

      const tenantResult = await client.query<{ id: string; slug: string; name: string }>(
        "SELECT id, slug, name FROM tenants WHERE id = $1 LIMIT 1",
        [user.tenant_id]
      );

      return { user, session, tenant: tenantResult.rows[0] };
    });

    if (!result || "statusCode" in result) {
      return result;
    }

    setRefreshCookie(reply, result.session.refreshToken);

    return {
      access_token: result.session.accessToken,
      tenant: result.tenant,
      user: result.user,
      mode: "google_oauth"
    };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const rawRefreshToken = request.cookies[getRefreshCookieName()];

    if (!rawRefreshToken) {
      return reply.code(401).send({ message: "Missing refresh token cookie" });
    }

    const nextSession = await refreshSession(rawRefreshToken, request.tenant.id);

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

  app.post("/auth/onboarding", { preHandler: authenticate }, async (request, reply) => {
    if (request.user.is_platform_admin) {
      return reply.code(409).send({ message: "Main admin does not use company onboarding" });
    }

    const body = onboardingSchema.parse(request.body);

    const result = await withTransaction(async (client) => {
      const defaultTenantResult = await client.query<{
        id: string;
        slug: string;
        name: string;
      }>(
        `
          SELECT id, slug, name
          FROM tenants
          WHERE id = $1
          LIMIT 1
        `,
        [PLATFORM_TENANT_ID]
      );

      const defaultTenant = defaultTenantResult.rows[0];
      let responseTenant = defaultTenant;

      if (body.user_type === "individual") {
        await client.query(
          `
            UPDATE users
            SET
              tenant_id = $2,
              user_type = 'individual',
              username = $3,
              college_name = NULL,
              student_id = NULL,
              company_name = NULL,
              membership_type = 'player',
              entered_reference_id = NULL,
              onboarding_completed = TRUE,
              is_admin = FALSE,
              updated_at = NOW()
            WHERE id = $1
          `,
          [request.user.id, PLATFORM_TENANT_ID, body.username.trim()]
        );

        await client.query(
          `
            UPDATE oauth_accounts
            SET tenant_id = $2
            WHERE user_id = $1
          `,
          [request.user.id, PLATFORM_TENANT_ID]
        );
      } else if (body.user_type === "student") {
        const collegeResult = await client.query<{
          id: string;
          slug: string;
          name: string;
        }>(
          `
            SELECT id, slug, name
            FROM tenants
            WHERE LOWER(name) = LOWER($1)
              AND company_type = 'college'
              AND is_active = TRUE
            LIMIT 2
          `,
          [body.college_name.trim()]
        );

        if ((collegeResult.rowCount ?? 0) > 1) {
          return reply.code(409).send({ message: "Multiple colleges share this name. Ask the main admin to rename them." });
        }

        if (collegeResult.rowCount !== 1) {
          return reply.code(404).send({ message: "College was not found. Ask the main admin to create it first." });
        }

        await client.query(
          `
            UPDATE users
            SET
              tenant_id = $2,
              user_type = 'student',
              username = NULL,
              college_name = $3,
              student_id = $4,
              company_name = NULL,
              membership_type = 'student',
              entered_reference_id = $4,
              onboarding_completed = TRUE,
              is_admin = FALSE,
              updated_at = NOW()
            WHERE id = $1
          `,
          [request.user.id, PLATFORM_TENANT_ID, body.college_name.trim(), body.student_id.trim()]
        );

        await client.query(
          `
            UPDATE oauth_accounts
            SET tenant_id = $2
            WHERE user_id = $1
          `,
          [request.user.id, PLATFORM_TENANT_ID]
        );
      } else {
        const companyResult = await client.query<{
          id: string;
          slug: string;
          name: string;
        }>(
          `
            SELECT id, slug, name
            FROM tenants
            WHERE LOWER(name) = LOWER($1)
              AND company_type = 'company'
              AND is_active = TRUE
            LIMIT 2
          `,
          [body.company_name.trim()]
        );

        if ((companyResult.rowCount ?? 0) > 1) {
          return reply.code(409).send({ message: "Multiple companies share this name. Ask the main admin to rename them." });
        }

        if (companyResult.rowCount !== 1) {
          return reply.code(404).send({ message: "Company was not found. Ask the main admin to create it first." });
        }

        const company = companyResult.rows[0];
        responseTenant = company;

        try {
          await client.query(
            `
              UPDATE users
              SET
                tenant_id = $2,
                user_type = 'employee',
                username = NULL,
                college_name = NULL,
                student_id = NULL,
                company_name = $3,
                membership_type = 'employee',
                entered_reference_id = $4,
                onboarding_completed = TRUE,
                is_admin = FALSE,
                updated_at = NOW()
              WHERE id = $1
            `,
            [request.user.id, company.id, company.name, body.company_id.trim()]
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            return reply.code(409).send({
              message: "A user with this email already exists in that company. Sign in with the existing company account instead."
            });
          }

          throw error;
        }

        await client.query(
          `
            UPDATE oauth_accounts
            SET tenant_id = $2
            WHERE user_id = $1
          `,
          [request.user.id, company.id]
        );

        if (body.request_admin_access) {
          await client.query(
            `
              INSERT INTO access_requests (user_id, tenant_id, request_type, notes)
              VALUES ($1, $2, 'admin_access', $3)
              ON CONFLICT (user_id, tenant_id, request_type) WHERE status = 'pending' DO NOTHING
            `,
            [request.user.id, company.id, 'Requested during onboarding']
          );
        }
      }

      const updatedUserResult = await client.query<UserRow>(
        `
          SELECT
            id,
            email,
            name,
            avatar_url,
            wallet_balance,
            tenant_id,
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
        [request.user.id]
      );

      const updatedUser = updatedUserResult.rows[0];
      const session = await createSession(
        {
          id: updatedUser.id,
          email: updatedUser.email,
          tenant_id: updatedUser.tenant_id,
          is_admin: updatedUser.is_admin,
          is_platform_admin: updatedUser.is_platform_admin,
          is_banned: updatedUser.is_banned
        },
        client
      );

      return {
        user: updatedUser,
        tenant: responseTenant,
        session
      };
    });

    if (!result || "statusCode" in result) {
      return result;
    }

    setRefreshCookie(reply, result.session.refreshToken);

    return {
      access_token: result.session.accessToken,
      tenant: result.tenant,
      user: result.user
    };
  });

  app.get("/auth/me", { preHandler: authenticate }, async (request) => ({
    user: request.user,
    tenant: request.tenant
  }));
}
