import pg from "pg";

const { Pool } = pg;
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000001";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function resetPlatformData() {
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL").replace("@localhost:", "@127.0.0.1:")
  });

  try {
    await pool.query(`
      TRUNCATE TABLE
        answers,
        contest_members,
        questions,
        contests,
        wallet_transactions,
        wallet_requests,
        refresh_tokens,
        oauth_accounts,
        users
      RESTART IDENTITY CASCADE
    `);

    await pool.query(
      `
        DELETE FROM tenants
        WHERE id <> $1
      `,
      [PLATFORM_TENANT_ID]
    );

    await pool.query(
      `
        UPDATE tenants
        SET
          name = 'Platform Workspace',
          slug = 'default',
          plan = 'enterprise',
          company_type = 'company',
          code_or_reference_id = 'FISSION-MAIN',
          id_pattern = NULL,
          is_active = TRUE,
          updated_at = NOW()
        WHERE id = $1
      `,
      [PLATFORM_TENANT_ID]
    );

    console.log("Platform data reset complete. Main admin will be created on first Google login.");
  } finally {
    await pool.end();
  }
}

resetPlatformData().catch((error) => {
  console.error("Platform data reset failed", error);
  process.exitCode = 1;
});
