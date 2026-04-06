import { pool } from "@quiz-app/db";

async function seed() {
  const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

  const existingContest = await pool.query<{ id: string }>(
    "SELECT id FROM contests WHERE title = 'General Knowledge Sprint' AND tenant_id = $1 LIMIT 1",
    [DEFAULT_TENANT_ID]
  );

  const contestId =
    existingContest.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `
          INSERT INTO contests (title, status, entry_fee, max_members, starts_at, prize_rule, tenant_id)
          VALUES ('General Knowledge Sprint', 'draft', '10.00', 100, NOW() + INTERVAL '30 minutes', 'all_correct', $1)
          RETURNING id
        `,
        [DEFAULT_TENANT_ID]
      )
    ).rows[0].id;

  const existingQuestions = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM questions WHERE contest_id = $1",
    [contestId]
  );

  if (Number(existingQuestions.rows[0].count) === 0) {
    await pool.query(
      `
        INSERT INTO questions (
          contest_id, seq, body, option_a, option_b, option_c, option_d, correct_option, time_limit_sec
        )
        VALUES
          ($1, 1, 'What is the capital of India?', 'Mumbai', 'New Delhi', 'Chennai', 'Kolkata', 'b', 15),
          ($1, 2, 'Which planet is known as the Red Planet?', 'Venus', 'Saturn', 'Mars', 'Mercury', 'c', 15),
          ($1, 3, 'How many minutes are in one hour?', '45', '50', '55', '60', 'd', 15)
      `,
      [contestId]
    );
  }

  console.log("Seed completed");
  await pool.end();
}

seed().catch((error) => {
  console.error("Seed failed", error);
  process.exitCode = 1;
});
