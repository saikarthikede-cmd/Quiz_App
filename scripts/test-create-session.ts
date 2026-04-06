import pg from "pg";
import { SignJWT } from "jose";

const { Pool } = pg;

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoolean(value: string | undefined) {
  return value === "true";
}

async function main() {
  const email = requireEnv("TEST_EMAIL").trim().toLowerCase();
  const name = (process.env.TEST_NAME ?? email.split("@")[0]).trim();
  const tenantSlug = (process.env.TEST_TENANT_SLUG ?? "default").trim().toLowerCase();
  const forceAdmin = parseBoolean(process.env.TEST_FORCE_ADMIN);
  const forcePlatformAdmin = parseBoolean(process.env.TEST_FORCE_PLATFORM_ADMIN);
  const minimumBalance = Number(process.env.TEST_MIN_BALANCE ?? "0");

  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL").replace("@localhost:", "@127.0.0.1:")
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantResult = await client.query<{ id: string; slug: string }>(
      "SELECT id, slug FROM tenants WHERE slug = $1 AND is_active = TRUE LIMIT 1",
      [tenantSlug]
    );

    if (tenantResult.rowCount !== 1) {
      throw new Error(`Tenant not found: ${tenantSlug}`);
    }

    const tenant = tenantResult.rows[0];
    let userResult = await client.query<{
      id: string;
      email: string;
      name: string;
      avatar_url: string | null;
      wallet_balance: string;
      is_admin: boolean;
      is_platform_admin: boolean;
      is_banned: boolean;
    }>(
      `
        SELECT id, email, name, avatar_url, wallet_balance, is_admin, is_platform_admin, is_banned
        FROM users
        WHERE email = $1
          AND tenant_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [email, tenant.id]
    );

    if (userResult.rowCount !== 1) {
      const isAdmin = forceAdmin;
      const isPlatformAdmin = forcePlatformAdmin;

      userResult = await client.query(
        `
          INSERT INTO users (email, name, is_admin, is_platform_admin, tenant_id)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, email, name, avatar_url, wallet_balance, is_admin, is_platform_admin, is_banned
        `,
        [email, name, isAdmin, isPlatformAdmin, tenant.id]
      );
    } else if (forceAdmin || forcePlatformAdmin) {
      userResult = await client.query(
        `
          UPDATE users
          SET
            name = $2,
            is_admin = CASE WHEN $3 THEN TRUE ELSE is_admin END,
            is_platform_admin = CASE WHEN $4 THEN TRUE ELSE is_platform_admin END,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, email, name, avatar_url, wallet_balance, is_admin, is_platform_admin, is_banned
        `,
        [userResult.rows[0].id, name, forceAdmin, forcePlatformAdmin]
      );
    }

    const user = userResult.rows[0];
    const currentBalance = Number(user.wallet_balance);

    if (minimumBalance > currentBalance) {
      const amount = Number((minimumBalance - currentBalance).toFixed(2));
      const balanceBefore = currentBalance.toFixed(2);
      const balanceAfter = minimumBalance.toFixed(2);

      await client.query(
        `
          INSERT INTO wallet_transactions (
            user_id,
            type,
            reason,
            amount,
            balance_before,
            balance_after,
            metadata
          )
          VALUES ($1, 'credit', 'topup', $2, $3, $4, $5::jsonb)
        `,
        [
          user.id,
          amount.toFixed(2),
          balanceBefore,
          balanceAfter,
          JSON.stringify({ source: "test_session_bootstrap" })
        ]
      );

      user.wallet_balance = balanceAfter;

      await client.query(
        "UPDATE users SET wallet_balance = $2, updated_at = NOW() WHERE id = $1",
        [user.id, balanceAfter]
      );
    }

    await client.query("COMMIT");

    const jwtSecret = new TextEncoder().encode(requireEnv("JWT_SECRET"));
    const token = await new SignJWT({
      user_id: user.id,
      email: user.email,
      tenant_id: tenant.id,
      is_banned: user.is_banned,
      is_admin: user.is_admin,
      is_platform_admin: user.is_platform_admin
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer(process.env.JWT_ISSUER ?? "quiz-app")
      .setAudience(process.env.JWT_AUDIENCE ?? "quiz-app-users")
      .setExpirationTime(`${process.env.ACCESS_TOKEN_TTL_MINUTES ?? "15"}m`)
      .sign(jwtSecret);

    process.stdout.write(
      JSON.stringify({
        access_token: token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          wallet_balance: user.wallet_balance,
          is_admin: user.is_admin,
          is_platform_admin: user.is_platform_admin
        },
        tenant: tenant.slug
      })
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
