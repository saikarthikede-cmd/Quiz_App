# Requirements Document

## Introduction

A production-grade, mobile-first real-time quiz contest platform where users join live quiz contests, answer timed questions, and win prize money. Each contest charges ₹10 entry fee per participant. The prize pool equals the total entry fees collected. Winners are participants who answer all questions correctly and split the prize pool equally. Contests support up to 100 members and multiple contests can run simultaneously.

The platform is built as a monorepo with four separate services: an HTTP API server (Fastify), a WebSocket game server (Socket.io), a background worker server (BullMQ), and a Next.js frontend. PostgreSQL is the primary data store, Redis handles caching, pub/sub, and job queuing.

---

## Glossary


- **API_Server**: The Fastify HTTP service handling auth, wallet, contest management, and leaderboard endpoints.
- **Game_Server**: The Socket.io WebSocket service handling live player connections and answer submissions.
- **Worker_Server**: The BullMQ worker service handling contest lifecycle, payouts, and reconciliation.
- **Frontend**: The Next.js mobile-first web application.
- **User**: An authenticated person who has signed in via Google OAuth.
- **Contest**: A scheduled quiz event with a configurable number of questions, an entry fee, and a prize pool.
- **Question**: A multiple-choice item with four options (a, b, c, d) and a single correct answer, belonging to a Contest.
- **Contest_Member**: A User who has paid the entry fee and joined a Contest.
- **Answer**: A Contest_Member's response to a single Question during live gameplay.
- **Wallet**: A User's in-app balance used to pay entry fees and receive prize payouts.
- **Wallet_Transaction**: An immutable ledger record of every credit or debit to a Wallet.
- **Prize_Pool**: The total entry fees collected for a Contest (member_count × entry_fee).
- **Winner**: A Contest_Member who answered all questions in the contest correctly.
- **Reconciliation**: The process of recomputing scores from Postgres answers before payout to correct any Redis inconsistencies.
- **Job**: A BullMQ task placed on a queue for asynchronous processing by the Worker_Server.
- **Redis_Adapter**: The @socket.io/redis-adapter enabling cross-instance Socket.io broadcasting.
- **JWT**: A JSON Web Token used as a short-lived access credential.
- **Refresh_Token**: A long-lived opaque token stored as a SHA-256 hash in the database, used to rotate JWT access tokens.

---

## Requirements

### Requirement 1: User Authentication via Google Sign-In

**User Story:** As a visitor, I want to sign in with my Google account, so that I can access the platform without creating a separate username and password.

#### Acceptance Criteria

1. WHEN a User completes Google OAuth consent, THE API_Server SHALL look up an existing `oauth_accounts` row where `provider='google'` AND `provider_uid` matches the Google subject ID.
2. IF no matching `oauth_accounts` row exists AND a `users` row with the same email exists, THEN THE API_Server SHALL create a new `oauth_accounts` row linking to the existing `users` row.
3. IF no matching `oauth_accounts` row exists AND no `users` row with the same email exists, THEN THE API_Server SHALL create a new `users` row and a new `oauth_accounts` row within a single Postgres transaction.
4. WHEN authentication succeeds, THE API_Server SHALL issue a JWT access token with a 15-minute expiry containing `user_id` and `is_banned`.
5. WHEN authentication succeeds, THE API_Server SHALL issue a refresh token as 32 cryptographically random bytes, store its SHA-256 hash in the `refresh_tokens` table with a 30-day expiry, and deliver the raw token in an `httpOnly` cookie.
6. WHEN a client presents an expired JWT and a valid refresh token cookie, THE API_Server SHALL verify the raw token by hashing and comparing to the stored hash, confirm `revoked_at` is NULL and `expires_at` is in the future, issue a new JWT, revoke the old refresh token, and insert a new refresh token.
7. IF a User's `is_banned` field is `true`, THEN THE API_Server SHALL reject all authenticated requests with a 403 status.

---

### Requirement 2: Contest Listing and Discovery

**User Story:** As a User, I want to browse available contests, so that I can choose one to join.

#### Acceptance Criteria

1. THE API_Server SHALL expose a `GET /contests` endpoint returning contests with `status='open'` ordered by `starts_at` ascending.
2. WHEN returning contest data, THE API_Server SHALL include `id`, `title`, `entry_fee`, `max_members`, `member_count`, `starts_at`, and derived `prize_pool` (calculated as `member_count × entry_fee`).
3. WHILE a Contest has `status='open'` AND `member_count < max_members`, THE API_Server SHALL include it in the listing response.
4. IF a Contest has `member_count = max_members`, THEN THE API_Server SHALL exclude it from the open listing.

---

### Requirement 3: Joining a Contest

**User Story:** As a User, I want to join an open contest by paying the entry fee from my wallet, so that I can participate in the quiz.

#### Acceptance Criteria

1. WHEN a User calls `POST /contests/:id/join`, THE API_Server SHALL verify the JWT access token before processing.
2. WHEN a join request is received, THE API_Server SHALL confirm the Contest has `status='open'` and `member_count < max_members`; IF either condition fails, THEN THE API_Server SHALL return a 409 error.
3. WHEN a join request is received, THE API_Server SHALL confirm the User is not already in `contest_members` for this Contest; IF already joined, THEN THE API_Server SHALL return a 409 error.
4. WHEN all preconditions pass, THE API_Server SHALL execute a single Postgres transaction that: acquires a row-level lock on the `users` row, verifies `wallet_balance >= entry_fee`, inserts a `wallet_transactions` row with `type='debit'`, `reason='entry_fee'`, inserts a `contest_members` row, and increments `contests.member_count` by 1.
5. IF `wallet_balance < entry_fee`, THEN THE API_Server SHALL rollback the transaction and return a 402 error with an insufficient balance message.
6. WHEN the join transaction commits successfully, THE API_Server SHALL add the `user_id` to the Redis set `contest:{id}:members`.
7. WHEN a User successfully joins, THE Game_Server SHALL emit a `lobby_update` event to all members in the contest room with the updated `member_count` and `prize_pool`.

---

### Requirement 4: Contest Publish

**User Story:** As an admin, I want to publish a contest so that it becomes visible to players and its lifecycle jobs are scheduled.

#### Acceptance Criteria

1. WHEN an admin calls `POST /admin/contests/:id/publish`, THE API_Server SHALL validate that the Contest exists, `status='draft'`, at least 1 Question exists, and `starts_at` is in the future; IF any check fails, THE API_Server SHALL return a 422 error.
2. WHEN all validations pass, THE API_Server SHALL update `contests.status` to `'open'` in Postgres and schedule a `start-contest` Job on the `contest-lifecycle` queue with delay until `starts_at` and `jobId='start-contest:{contest_id}'`.
3. THE API_Server SHALL return 200 on success.

---

### Requirement 5: Contest Lifecycle — Job Chain

**User Story:** As the platform, I want contests to progress through all questions automatically via a BullMQ job chain, so that no manual intervention is required during gameplay.

#### Acceptance Criteria

**start-contest job:**
1. WHEN the `start-contest` Job fires, THE Worker_Server SHALL check `contests.status` in Postgres; IF `status='live'`, THE Worker_Server SHALL skip and return (idempotency).
2. WHEN proceeding, THE Worker_Server SHALL update `contests.status` to `'live'`, `contests.current_q` to `1`, and `contests.q_started_at` to the current timestamp in Postgres.
3. THE Worker_Server SHALL cache all Questions for the contest in Redis hashes `contest:{id}:question:{seq}` with TTL set to contest start time plus total possible question time plus 1 hour buffer.
4. THE Worker_Server SHALL set `contest:{id}:state` in Redis with `current_q=1` and `q_started_at=<epoch ms>`.
5. THE Worker_Server SHALL publish a `question` event for question 1 to the Redis channel `contest:{id}`.
6. THE Worker_Server SHALL schedule two jobs: `reveal-question` with `seq=1` and delay `Q1.time_limit_sec * 1000ms` with `jobId='reveal-question:{contest_id}:1'`; and `broadcast-question` with `seq=2` and delay `Q1.time_limit_sec * 1000ms + 3000ms` with `jobId='broadcast-question:{contest_id}:2'` (only if the contest has more than 1 question; otherwise schedule `end-contest` instead of `broadcast-question`).

**reveal-question job (seq=N):**
7. WHEN the `reveal-question` Job fires with `seq=N`, THE Worker_Server SHALL check `contests.current_q` in Postgres; IF `current_q < N`, THE Worker_Server SHALL skip and return (question was never broadcast).
8. THE Worker_Server SHALL check `questions.revealed_at` for question `N`; IF already set, THE Worker_Server SHALL skip and return (idempotency).
9. THE Worker_Server SHALL fetch `correct_option` for question `N` from Redis cache `contest:{id}:question:{N}`; IF the Redis key is missing or Redis is unavailable, THE Worker_Server SHALL fall back to querying `questions.correct_option` from Postgres directly; THE Worker_Server SHALL then publish a `reveal` event for question `N` to the Redis channel `contest:{id}`.
10. THE Worker_Server SHALL update `questions.revealed_at` to the current timestamp in Postgres.

**broadcast-question job (seq=N):**
11. WHEN the `broadcast-question` Job fires with `seq=N`, THE Worker_Server SHALL check `contests.current_q` in Postgres; IF `current_q >= N`, THE Worker_Server SHALL skip and return (idempotency).
12. THE Worker_Server SHALL update `contests.current_q` to `N` and `contests.q_started_at` to the current timestamp in Postgres.
13. THE Worker_Server SHALL set `contest:{id}:state` in Redis with `current_q=N` and `q_started_at=<epoch ms>`.
14. THE Worker_Server SHALL publish a `question` event for question `N` to the Redis channel `contest:{id}`.
15. IF `N < total_questions`, THE Worker_Server SHALL schedule: `reveal-question` with `seq=N` and delay `Q{N}.time_limit_sec * 1000ms` with `jobId='reveal-question:{contest_id}:{N}'`; and `broadcast-question` with `seq=N+1` and delay `Q{N}.time_limit_sec * 1000ms + 3000ms` with `jobId='broadcast-question:{contest_id}:{N+1}'`.
16. IF `N = total_questions`, THE Worker_Server SHALL schedule: `reveal-question` with `seq=N` and delay `Q{N}.time_limit_sec * 1000ms` with `jobId='reveal-question:{contest_id}:{N}'`; and `end-contest` with delay `Q{N}.time_limit_sec * 1000ms + 3000ms` with `jobId='end-contest:{contest_id}'`.

**end-contest job:**
17. WHEN the `end-contest` Job fires, THE Worker_Server SHALL check `contests.status` in Postgres; IF `status='ended'`, THE Worker_Server SHALL skip and return (idempotency).
18. THE Worker_Server SHALL update `contests.status` to `'ended'` and `contests.ended_at` to the current timestamp in Postgres.
19. THE Worker_Server SHALL run Reconciliation — query Postgres for each user's correct answer count and overwrite Redis scores via pipeline.
20. THE Worker_Server SHALL always distribute the prize pool — IF `prize_rule='all_correct'`, winners are members whose correct answer count equals the total number of questions; IF no member answered all questions correctly, OR IF `prize_rule='top_scorer'`, winners are all members tied at the highest correct answer count.
21. THE Worker_Server SHALL calculate `prize_amount` per winner using FLOOR division: `prize_amount = FLOOR((member_count * entry_fee) / winner_count * 100) / 100`; the remainder (due to rounding) SHALL be credited to the first winner (ordered by `joined_at` ascending) in addition to their standard share.
22. THE Worker_Server SHALL update each winner's `contest_members` row with `is_winner=true` and their respective `prize_amount`, then enqueue one `prize-credit` Job per winner on the `payouts` queue with `jobId='prize-credit:{contest_id}:{user_id}'`.
23. THE Worker_Server SHALL build a leaderboard from Postgres ordered by correct answer count descending and publish a `contest_ended` event to the Redis channel `contest:{id}`.
24. THE Worker_Server SHALL delete all Redis keys for the Contest.

**prize-credit job:**
25. WHEN the `prize-credit` Job fires, THE Worker_Server SHALL check `wallet_transactions` for an existing credit where `user_id` matches, `reason='prize'`, and `reference_id=contest_id`; IF found, THE Worker_Server SHALL skip and return (idempotency).
26. THE Worker_Server SHALL credit the winner's wallet in a single Postgres transaction following the standard wallet transaction pattern with `reason='prize'` and `reference_id=contest_id`.

**Failure handling:**
27. WHEN any `contest-lifecycle` Job fails after 5 retry attempts, THE Worker_Server SHALL send an alert with job name, contest id, and error details.
28. IF the failed job is `start-contest` or `broadcast-question`, THE Worker_Server SHALL enqueue a `refund-contest` Job with `jobId='refund-contest:{contest_id}'`.
29. IF the failed job is `reveal-question`, THE Worker_Server SHALL alert only and NOT trigger a refund — a failed reveal does not affect contest progression and is recoverable without cancelling the contest.
30. IF the failed job is `end-contest`, THE Worker_Server SHALL alert only and NOT refund, as players completed the contest fairly and require manual intervention.
30. WHEN the `refund-contest` Job fires, THE Worker_Server SHALL check `contests.status`; IF `status='cancelled'`, THE Worker_Server SHALL skip and return (idempotency); OTHERWISE update `contests.status` to `'cancelled'` and enqueue one `refund` Job per member with `jobId='refund:{contest_id}:{user_id}'`.
31. WHEN the `refund` Job fires, THE Worker_Server SHALL check `wallet_transactions` for an existing refund where `user_id` matches, `reason='refund'`, and `reference_id=contest_id`; IF found, THE Worker_Server SHALL skip and return (idempotency); OTHERWISE credit the member's wallet following the standard wallet transaction pattern.

---

### Requirement 6: Live Quiz Gameplay via WebSocket

**User Story:** As a Contest_Member, I want to receive questions in real time and submit answers during the time window, so that I can compete in the live quiz.

#### Acceptance Criteria

1. WHEN a Contest_Member connects to the Game_Server with a valid JWT in the socket handshake `auth` field, THE Game_Server SHALL authenticate the connection and add the socket to the Socket.io room `contest:{contest_id}`.
2. WHEN the Worker_Server publishes a `question` event to Redis channel `contest:{id}`, THE Game_Server SHALL broadcast the event to all sockets in room `contest:{contest_id}` including `seq`, `body`, `option_a`, `option_b`, `option_c`, `option_d`, `time_limit_sec`, and `server_time` (epoch ms).
3. WHEN the Worker_Server publishes a `reveal` event to Redis channel `contest:{id}`, THE Game_Server SHALL broadcast it to all sockets in room `contest:{contest_id}` including `seq` and `correct_option`.
4. WHEN a Contest_Member submits a `submit_answer` message with `{ contest_id, question_seq, chosen_option }`, THE Game_Server SHALL validate the JWT from the socket handshake.
5. WHEN processing a `submit_answer`, THE Game_Server SHALL check the Redis set `contest:{id}:members`; IF the user is not a member, THEN THE Game_Server SHALL emit `{ type: 'error', code: 'NOT_IN_CONTEST' }`.
6. WHEN processing a `submit_answer`, THE Game_Server SHALL check `contest:{id}:state.current_q` matches `question_seq` and server time is within `q_started_at + time_limit_sec`; IF not, THEN THE Game_Server SHALL emit `{ type: 'error', code: 'TIME_UP' }`.
7. WHEN processing a `submit_answer`, THE Game_Server SHALL check the Redis set `contest:{id}:answered:{seq}`; IF the user is already present, THEN THE Game_Server SHALL emit `{ type: 'error', code: 'ALREADY_ANSWERED' }`.
8. WHEN all validations pass, THE Game_Server SHALL fetch `correct_option` from Redis hash `contest:{id}:question:{seq}`; IF the Redis key is missing or Redis is unavailable, THE Game_Server SHALL fall back to querying `questions.correct_option` from Postgres directly; IF the Postgres fallback also fails, THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` and return.
9. THE Game_Server SHALL determine `is_correct` by comparing `chosen_option` to `correct_option`, then execute `INSERT INTO answers (contest_id, question_id, user_id, chosen_option, is_correct) ON CONFLICT DO NOTHING RETURNING id` in Postgres; IF the insert fails, THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` and return.
10. WHEN the Postgres insert succeeds, THE Game_Server SHALL add the `user_id` to Redis set `contest:{id}:answered:{seq}`; IF `is_correct`, THE Game_Server SHALL increment the user's score in Redis hash `contest:{id}:scores`; IF either Redis write fails, THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` and return.
11. WHEN all writes succeed, THE Game_Server SHALL emit `{ type: 'answer_result', is_correct, your_score }` to the submitting socket; the `correct_option` SHALL NOT be included in this response — it is revealed to all players only via the `reveal` event after the time window closes.
12. WHEN a Contest_Member reconnects during an active Contest, THE Game_Server SHALL emit `{ type: 'reconnected', current_q, score, time_remaining }` using state from Redis `contest:{id}:state`.
13. WHEN the client receives a `reveal` event, THE Frontend SHALL display the correct answer, highlight the player's choice as right or wrong, and start a local 3-second UI countdown before displaying the next question.
14. WHEN the client receives a `question` event, THE Frontend SHALL use `server_time` from the event to synchronise the answer timer with the server.

---

### Requirement 7: Cross-Instance Real-Time Broadcasting

**User Story:** As the platform, I want WebSocket events to reach all connected players regardless of which Game_Server instance they are connected to, so that the system scales horizontally.

#### Acceptance Criteria

1. THE Game_Server SHALL use `@socket.io/redis-adapter` so that Socket.io rooms are shared across all Game_Server instances.
2. WHEN the Worker_Server publishes a message to Redis Pub/Sub channel `contest:{id}`, EACH Game_Server instance SHALL receive the message and call `io.to('contest:{id}').emit(message)` to forward it to locally connected sockets.
3. THE API_Server SHALL be stateless and SHALL scale horizontally without coordination between instances.

---

### Requirement 8: Prize Reconciliation and Payout

**User Story:** As a Winner, I want my prize credited to my wallet automatically after the contest ends, so that I receive my winnings without manual intervention.

#### Acceptance Criteria

1. WHEN the `end-contest` Job runs Reconciliation, THE Worker_Server SHALL query Postgres for each user's correct answer count (`COUNT(*) FILTER (WHERE is_correct = true)`) and overwrite the corresponding Redis score entries via a pipeline.
2. WHEN calculating Winners, THE Worker_Server SHALL always distribute the prize pool — IF `prize_rule='all_correct'` and at least one member answered all questions correctly, those members are the winners; IF no member answered all questions correctly, OR IF `prize_rule='top_scorer'`, winners are all members tied at the highest correct answer count.
3. WHEN Winners are determined, THE Worker_Server SHALL calculate `prize_amount` per winner using FLOOR division; the remainder SHALL be credited to the first winner by `joined_at` ascending; THE Worker_Server SHALL update each winner's `contest_members` row with `is_winner=true` and `prize_amount`.
4. THE Worker_Server SHALL always distribute the full prize pool — there is no scenario where the prize pool is left undistributed.
5. WHEN a `prize-credit` Job executes, THE Worker_Server SHALL check `wallet_transactions` for an existing credit where `user_id` matches, `reason='prize'`, and `reference_id=contest_id`; IF found, THE Worker_Server SHALL skip the job (idempotency).
6. WHEN a `prize-credit` Job proceeds, THE Worker_Server SHALL execute a Postgres transaction that: acquires a row-level lock on the `users` row, inserts a `wallet_transactions` row with `type='credit'`, `reason='prize'`, `reference_id=contest_id`, and updates `users.wallet_balance`.
7. WHEN a `refund` Job executes, THE Worker_Server SHALL check `wallet_transactions` for an existing refund with `reason='refund'` AND `reference_id=contest_id` for the user before crediting (idempotency check).
8. WHEN a `refund` Job proceeds, THE Worker_Server SHALL execute a Postgres transaction crediting the entry fee back to the User's Wallet with `reason='refund'` and `reference_id=contest_id`.

---

### Requirement 9: Leaderboard

**User Story:** As a User, I want to see the contest leaderboard after a contest ends, so that I can see how everyone performed.

#### Acceptance Criteria

1. THE API_Server SHALL expose a `GET /contests/:id/leaderboard` endpoint.
2. WHEN the leaderboard endpoint is called for an ended Contest, THE API_Server SHALL return Contest_Members ordered by `correct_count` descending, then by `answered_at` of their last answer ascending (fastest wins tiebreak), including `user_id`, `name`, `avatar_url`, `correct_count`, `is_winner`, and `prize_amount`.
3. WHEN the `contest_ended` WebSocket event is emitted, THE Game_Server SHALL include a `leaderboard` array and a `you_won` boolean and `prize_amount` for the receiving socket's user.

---

### Requirement 10: Redis Failure Resilience

**User Story:** As the platform, I want the system to degrade gracefully when Redis is unavailable, so that transient Redis failures do not cause data loss or crash the service.

#### Acceptance Criteria

1. THE Game_Server SHALL apply a 200ms timeout to all Redis commands.
2. THE Game_Server SHALL retry failed Redis commands up to 3 times with 100ms incremental backoff before treating the command as failed.
3. IF a Redis read for validation (membership check, phase check) fails after retries, THEN THE Game_Server SHALL fall back to a Postgres query to obtain the required data and continue processing.
4. IF a Redis write for score update or answered-set membership fails after retries during answer submission, THEN THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` — these writes are required and failure is not tolerated.
5. IF a Redis phase check fails and no fallback is available, THEN THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` to the submitting socket.

---

### Requirement 11: Job Recovery After Redis Restart

**User Story:** As the platform, I want scheduled contest jobs to be automatically recovered after a Redis crash, so that contests are not silently lost when Redis restarts.

#### Acceptance Criteria

1. WHEN the Worker_Server starts up, THE Worker_Server SHALL query Postgres for all contests where `status='open'` and `starts_at` is within the next 10 minutes; for each, THE Worker_Server SHALL check if a `start-contest` job with `jobId='start-contest:{contest_id}'` exists in BullMQ; IF missing, THE Worker_Server SHALL reschedule it with the correct remaining delay.
2. WHEN the Worker_Server starts up, THE Worker_Server SHALL query Postgres for all contests where `status='live'`; for each, THE Worker_Server SHALL check if the expected `broadcast-question` and `reveal-question` jobs exist in BullMQ by jobId; IF missing, THE Worker_Server SHALL reschedule them with delays calculated from `contests.q_started_at` and the question's `time_limit_sec`.
3. WHEN the Worker_Server starts up for live contests, THE Worker_Server SHALL rebuild Redis state (`contest:{id}:state`, `contest:{id}:members`, `contest:{id}:question:{seq}`, `contest:{id}:scores`, `contest:{id}:answered:{seq}`) from Postgres if the keys are missing.
4. THE API_Server SHALL expose `POST /admin/contests/:id/recover` to allow an admin to manually trigger job recovery and Redis rebuild for a specific contest using the same logic as the startup routine.
5. WHEN the admin job monitor shows a published contest with no associated job, THE Frontend SHALL display a "Recover" button that calls `POST /admin/contests/:id/recover`.

---

### Requirement 12: Redis Rebuild from Postgres

**User Story:** As the platform, I want all Redis state to be fully rebuildable from Postgres, so that a Redis crash causes no permanent data loss.

#### Acceptance Criteria

1. THE `contests` table SHALL store `current_q` (int, default 0) and `q_started_at` (timestamptz) columns to track which question is live and when it started.
2. THE `questions` table SHALL store `revealed_at` (timestamptz, nullable) to track whether a question's answer has been revealed; NULL means not yet revealed.
3. WHEN the Worker_Server transitions to a new question, THE Worker_Server SHALL update `contests.current_q` and `contests.q_started_at` in Postgres atomically with the Redis state update.
4. WHEN Redis state for a live contest is missing, THE Worker_Server or API_Server SHALL rebuild `contest:{id}:state` from `contests.current_q` and `contests.q_started_at`.
5. WHEN Redis state for a live contest is missing, THE Worker_Server or API_Server SHALL rebuild `contest:{id}:members` from the `contest_members` table.
6. WHEN Redis state for a live contest is missing, THE Worker_Server or API_Server SHALL rebuild `contest:{id}:question:{seq}` hashes from the `questions` table.
7. WHEN Redis state for a live contest is missing, THE Worker_Server or API_Server SHALL rebuild `contest:{id}:scores` and `contest:{id}:answered:{seq}` sets from the `answers` table.
8. THE API_Server SHALL expose `POST /admin/contests/:id/rebuild-cache` to allow an admin to manually trigger a full Redis cache rebuild for a specific contest from Postgres.

---

### Requirement 13: Admin Contest Management

**User Story:** As an admin, I want to create contests and manage their questions, so that I can set up new quiz events.

#### Acceptance Criteria

1. THE Frontend SHALL provide a protected admin panel accessible only to users with admin privileges.
2. WHEN an admin creates a contest, THE API_Server SHALL accept `title`, `starts_at`, `entry_fee`, and `max_members` via `POST /admin/contests` and create the Contest with `status='draft'`.
3. THE Frontend admin panel SHALL provide a form to add questions to a Contest, each with `seq`, `body`, `option_a` through `option_d`, `correct_option`, and `time_limit_sec`.
4. THE API_Server SHALL expose `POST /admin/contests/:id/questions` to add a Question; IF `correct_option` is not one of `'a'`, `'b'`, `'c'`, `'d'`, THEN THE API_Server SHALL return a 422 error; IF a duplicate `seq` is submitted, THEN THE API_Server SHALL return a 409 error.
5. THE Frontend admin panel SHALL show a "Publish" button once at least 1 Question has been added; WHEN an admin clicks Publish, THE API_Server SHALL accept `POST /admin/contests/:id/publish` per Requirement 4.

---

### Requirement 14: Admin Contest Overview

**User Story:** As an admin, I want to see all contests and their results, so that I can monitor the platform.

#### Acceptance Criteria

1. THE API_Server SHALL expose `GET /admin/contests` returning all contests (all statuses) with `id`, `title`, `status`, `member_count`, `starts_at`, and `prize_pool`; THE Frontend SHALL display this as a list.
2. WHEN an admin views a specific ended Contest, THE Frontend SHALL display the leaderboard and winners list including each winner's name, correct answer count, and prize amount, fetched from `GET /contests/:id/leaderboard`.

---

### Requirement 15: Admin Wallet Management

**User Story:** As an admin, I want to manually credit a user's wallet, so that I can top up balances without a payment gateway.

#### Acceptance Criteria

1. THE API_Server SHALL expose `POST /admin/users/:id/wallet/credit` accepting an `amount`; THE API_Server SHALL execute the standard wallet transaction pattern (row lock → insert `wallet_transactions` with `type='credit'`, `reason='topup'` → update `users.wallet_balance`).
2. THE API_Server SHALL expose `GET /wallet/balance` returning the authenticated User's current `wallet_balance`.

---

### Requirement 16: Admin Job Monitor

**User Story:** As an admin, I want to see all scheduled and failed BullMQ jobs, so that I can detect and recover from Redis crashes by manually rescheduling missing jobs.

#### Acceptance Criteria

1. THE API_Server SHALL expose `GET /admin/jobs` returning all active, delayed, waiting, and failed BullMQ jobs across the `contest-lifecycle` and `payouts` queues, including `job_id`, `queue`, `job_name`, `data`, `status`, `attempts`, `failed_reason`, and `scheduled_for`; THE Frontend SHALL display this as a job monitor table.
2. THE API_Server SHALL expose `POST /admin/jobs/:queue/:job_id/retry` to manually re-enqueue a failed or missing job; WHEN called, THE API_Server SHALL add the job back to the specified queue with its original data.
3. WHEN an admin views a published Contest in the admin panel, THE Frontend SHALL display the associated `start-contest` job status so the admin can verify the job exists and trigger a reschedule if missing.

---

### Requirement 17: Answer Persistence

**User Story:** As the platform, I want all answer submissions to be durably stored in both Postgres and Redis, so that reconciliation, winner calculation, and real-time score tracking are consistent.

#### Acceptance Criteria

1. WHEN a valid Answer is submitted, THE Game_Server SHALL insert a row into the `answers` table with `contest_id`, `question_id`, `user_id`, `chosen_option`, `is_correct`, and `answered_at`.
2. THE Game_Server SHALL use `INSERT INTO answers ... ON CONFLICT (question_id, user_id) DO NOTHING RETURNING id` to ensure exactly-once persistence per user per question.
3. WHEN the Postgres insert succeeds, THE Game_Server SHALL add the `user_id` to the Redis set `contest:{id}:answered:{seq}`; IF this Redis write fails, THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` — this write is required, not best-effort.
4. WHEN the Answer is correct and the Postgres insert succeeds, THE Game_Server SHALL increment the user's score in the Redis hash `contest:{id}:scores`; IF this Redis write fails, THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` — this write is required, not best-effort.
5. IF the Postgres insert fails, THE Game_Server SHALL NOT update any Redis keys and SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }` to the socket.
6. WHEN deserializing incoming WebSocket messages, THE Game_Server SHALL validate that `chosen_option` is one of `'a'`, `'b'`, `'c'`, `'d'`; IF invalid, THEN THE Game_Server SHALL emit `{ type: 'error', code: 'SERVER_ERROR' }`.

---

### Requirement 18: Database Integrity and Wallet Ledger

**User Story:** As the platform, I want all financial operations to be atomic and auditable, so that wallet balances are always consistent with the transaction ledger.

#### Acceptance Criteria

1. THE API_Server SHALL never execute a direct `UPDATE users SET wallet_balance = ?` without a corresponding `wallet_transactions` insert in the same Postgres transaction.
2. WHEN any wallet-modifying transaction executes, THE API_Server SHALL acquire a row-level lock via `SELECT wallet_balance FROM users WHERE id = ? FOR UPDATE` before reading the balance.
3. THE API_Server SHALL store `balance_before` and `balance_after` on every `wallet_transactions` row such that `balance_after = balance_before + amount` for credits and `balance_after = balance_before - amount` for debits.
4. FOR ALL sequences of Wallet_Transactions for a given User, the final `balance_after` of the last transaction SHALL equal `users.wallet_balance` (ledger consistency invariant).
5. THE database SHALL enforce `wallet_transactions.amount > 0` via a CHECK constraint.

---

### Requirement 19: Shared Package Architecture

**User Story:** As a developer, I want shared code (DB client, Redis client, queue definitions, types) in dedicated packages, so that all services use consistent implementations without duplication.

#### Acceptance Criteria

1. THE monorepo SHALL contain a `/packages/db` package exporting a node-postgres `Pool`-connected Postgres client, migration runner, and typed query functions.
2. THE monorepo SHALL contain a `/packages/redis` package exporting the ioredis client and all Redis key helper functions (e.g., `contestStateKey(id)`, `contestMembersKey(id)`).
3. THE monorepo SHALL contain a `/packages/queues` package exporting BullMQ Queue instances and typed Job payload interfaces for `contest-lifecycle`, `payouts`, and `answers` queues.
4. THE monorepo SHALL contain a `/packages/types` package exporting shared TypeScript interfaces for `User`, `Contest`, `Question`, `Answer`, `ContestMember`, and `WalletTransaction`.
5. THE Worker_Server SHALL configure BullMQ workers with `concurrency: 10`, `attempts: 5`, and exponential backoff starting at 1000ms.
