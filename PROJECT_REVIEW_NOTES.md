# Quick Review Notes: Quiz App

## 1. What This Project Is

This is a real-time quiz contest platform where:

- users sign in with Google OAuth
- users join contests by paying an entry fee from their wallet
- questions are pushed live through WebSockets
- answers are stored in Postgres and tracked in Redis
- the worker progresses the contest automatically using BullMQ jobs
- winners are calculated and prize money is credited to wallets

The project is built as a monorepo with four services:

- `API Server` using Fastify
- `Game Server` using Socket.io
- `Worker Server` using BullMQ
- `Frontend` using Next.js

Shared logic is placed in:

- `packages/db`
- `packages/redis`
- `packages/queues`
- `packages/types`

---

## 2. Major Concepts You Must Know

### 2.1 Monorepo Architecture

Why it matters:

- all services live in one repository
- shared packages reduce duplication
- backend services use the same types, DB helpers, Redis helpers, and queue definitions

What to remember:

- `services/*` = runnable apps
- `packages/*` = reusable shared modules

---

### 2.2 Google OAuth Authentication

How it works in this project:

- frontend gets Google identity token
- API verifies that token using Google
- API checks `oauth_accounts`
- if account exists, login succeeds
- if account does not exist but email exists, link the Google account
- if neither exists, create user and `oauth_accounts` entry in one DB transaction

Important session concepts:

- short-lived `JWT access token`
- long-lived `refresh token`
- refresh token is stored in DB as a SHA-256 hash
- raw refresh token is sent in `httpOnly` cookie

Why this is important:

- secure session rotation
- no password storage
- banned users can be blocked centrally

---

### 2.3 JWT + Refresh Token Flow

Access token:

- used on authenticated API calls
- expires quickly

Refresh token:

- used to get a new access token
- old refresh token is revoked and a new one is issued

Key production idea:

- refresh token rotation reduces replay risk

---

### 2.4 Wallet Ledger Pattern

This is one of the most important concepts in the whole project.

Wallet rules:

- no direct balance update without ledger entry
- every credit/debit creates a `wallet_transactions` row
- each row stores:
  - `amount`
  - `balance_before`
  - `balance_after`
  - `reason`
  - `reference_id`

Concurrency safety:

- wallet row is locked using `SELECT ... FOR UPDATE`
- this prevents two simultaneous updates from corrupting balance

Why this matters:

- auditability
- financial correctness
- safe concurrent operations

---

### 2.5 Contest Join Transaction

When a user joins:

- contest is locked
- contest status and capacity are checked
- duplicate membership is checked
- wallet is debited
- contest member is inserted
- member count is incremented

Why it is important:

- prevents overbooking
- prevents double join
- prevents wallet inconsistency

---

### 2.6 Real-Time Gameplay via WebSocket

Game server responsibilities:

- authenticate socket using JWT
- put socket into contest room
- receive contest events
- validate answer submissions
- emit `answer_result`, `reveal`, `reconnected`, `contest_ended`

Important real-time concepts:

- room-based broadcasting
- reconnect state recovery
- server-synchronized timer using `server_time`

---

### 2.7 Redis in This Project

Redis is used for:

- contest membership sets
- contest state
- question cache
- answered-user sets
- score hash
- Pub/Sub between worker and game server
- BullMQ backing store

Examples of Redis keys:

- `contest:{id}:state`
- `contest:{id}:members`
- `contest:{id}:question:{seq}`
- `contest:{id}:scores`
- `contest:{id}:answered:{seq}`

Why Redis matters:

- faster validation during live gameplay
- real-time distributed event coordination

---

### 2.8 Redis Fallback and Recovery

The app does not blindly trust Redis forever.

If Redis read fails:

- game server can fall back to Postgres for membership, question, or state checks

If Redis restarts:

- worker can recover missing jobs
- cache can be rebuilt from Postgres

Why this matters:

- Redis is treated as recoverable state
- Postgres remains the source of truth

---

### 2.9 BullMQ Job Chain

Contest progression is automated using jobs:

- `start-contest`
- `reveal-question`
- `broadcast-question`
- `end-contest`
- `prize-credit`
- `refund-contest`
- `refund`

Why BullMQ is used:

- reliable delayed execution
- retries and backoff
- idempotent job handling

Important concept:

- the worker drives contest lifecycle, not the frontend

---

### 2.10 Idempotency

This is a very important backend concept.

Meaning:

- repeating the same action should not produce duplicate side effects

Examples in this project:

- start contest should not start twice
- reveal should not reveal twice
- payout should not credit twice
- refund should not refund twice
- answers use `ON CONFLICT DO NOTHING`

Why it matters:

- retries happen in real systems
- jobs may rerun
- sockets may reconnect

---

### 2.11 Answer Persistence

Answer submission flow:

1. validate membership
2. validate active question and timer
3. validate not already answered
4. fetch correct option
5. insert answer in Postgres
6. update Redis answered set
7. update Redis score hash if correct
8. emit score result

Key point:

- Postgres is durable source of truth
- Redis supports fast live state

---

### 2.12 Reconciliation

At contest end:

- worker recomputes each user’s correct answer count from Postgres
- Redis scores are overwritten using the true DB result

Why this matters:

- fixes any temporary Redis inconsistency
- ensures payout fairness

---

### 2.13 Winner Selection Logic

Prize rules supported:

- `all_correct`
- `top_scorer`

Behavior:

- if `all_correct` and at least one user gets all questions correct, those users win
- if nobody gets all correct, fallback is highest scorer(s)
- full prize pool is always distributed

Important rounding rule:

- prize is floor-divided
- any remainder goes to the first winner by `joined_at`

---

### 2.14 Leaderboard Logic

Leaderboard sorting:

- correct answers descending
- fastest last answer ascending for tie-break
- then stable joined order

Why it matters:

- ranking fairness
- deterministic winner display

---

### 2.15 Admin Recovery Controls

Admin can:

- create contests
- add questions
- publish contests
- view jobs
- retry or recreate missing jobs
- rebuild Redis cache
- recover contest jobs
- manage wallet requests

Why this matters:

- operational recovery is part of production readiness

---

### 2.16 Docker Execution

The project can run in Docker with:

- Postgres
- Redis
- API
- Game Server
- Worker
- Frontend

Why this matters:

- consistent environment
- easier demo and testing flow

---

## 3. Most Important Requirement-Driven Topics

If someone asks about the project, focus on these topics first:

1. `Google OAuth + JWT + refresh token rotation`
2. `Wallet ledger and financial consistency`
3. `Contest join transaction and concurrency safety`
4. `Socket.io real-time quiz flow`
5. `Redis cache + Postgres source-of-truth design`
6. `BullMQ lifecycle orchestration`
7. `Idempotent payout/refund jobs`
8. `Redis crash recovery and cache rebuild`
9. `Leaderboard and winner calculation`
10. `Monorepo shared package architecture`

---

## 4. Important Questions You May Be Asked

### Architecture Questions

1. Why did you split the system into API, game server, worker, and frontend?
2. Why use a monorepo instead of separate repositories?
3. Why are shared packages useful in this system?

### Authentication Questions

4. Why use Google OAuth instead of email/password?
5. Why store refresh tokens as hashes instead of raw values?
6. What is the difference between an access token and a refresh token?

### Wallet and DB Questions

7. How do you guarantee wallet consistency?
8. Why use `SELECT ... FOR UPDATE` in wallet operations?
9. Why should every wallet update create a ledger transaction?

### Contest and Concurrency Questions

10. How do you prevent a contest from exceeding max members?
11. How do you stop the same user from joining twice?
12. How do you handle concurrent joins safely?

### Real-Time Questions

13. Why use WebSockets for the quiz instead of polling?
14. How is the timer synchronized across users?
15. How do reconnecting users recover live contest state?

### Redis Questions

16. Why is Redis used if Postgres already stores data?
17. What happens if Redis fails during gameplay?
18. How do you rebuild Redis state after a restart?

### BullMQ Questions

19. Why use BullMQ for contest lifecycle?
20. What is idempotency and where is it used in your jobs?
21. How do retries and exponential backoff help here?

### Payout Questions

22. How are winners calculated?
23. What happens if nobody gets all questions correct?
24. How do you prevent duplicate prize credits?

### Production Questions

25. What makes this app production-grade?
26. What still needs improvement for stronger production readiness?
27. How would you monitor job failures in a real deployment?

---

## 5. Short Model Answers for Quick Review

### Q: Why use Redis if Postgres already exists?

Redis is used for fast live-state access, room coordination, Pub/Sub, and queued jobs. Postgres remains the durable source of truth, while Redis improves real-time performance.

### Q: Why use BullMQ?

BullMQ is used for delayed and retryable background jobs like contest start, reveal, next-question scheduling, payout, and refund. It removes timing logic from the frontend and makes contest progression reliable.

### Q: Why is the wallet considered safe?

Because every mutation is done inside a DB transaction, the wallet row is locked, and every credit/debit is recorded in an immutable ledger with before/after balances.

### Q: What happens if Redis crashes?

The system can rebuild Redis state from Postgres. Worker startup recovery and admin recovery endpoints can recreate jobs and cache so the contest can continue safely.

### Q: How do you prevent double answer submission?

The app checks Redis/Postgres for prior submission and also uses `INSERT ... ON CONFLICT DO NOTHING` in Postgres to enforce exactly-once persistence.

### Q: How do you ensure prizes are not credited twice?

Before crediting, the worker checks for an existing wallet transaction with `reason='prize'` and the same `reference_id=contest_id`. If it exists, the job is skipped.

---

## 6. Key Terms to Remember

- `Monorepo`
- `JWT`
- `Refresh token rotation`
- `OAuth`
- `Socket room`
- `Pub/Sub`
- `Redis adapter`
- `BullMQ`
- `Idempotency`
- `Reconciliation`
- `Ledger`
- `Row-level lock`
- `Source of truth`
- `Fallback`
- `Recovery`

---

## 7. Final Quick Summary

If you have only one minute to explain the project:

This project is a real-time quiz platform built with a monorepo architecture using Next.js, Fastify, Socket.io, BullMQ, Postgres, and Redis. The API handles auth, wallet, contests, and admin operations. The game server handles live question delivery and answer submission. The worker server automates contest lifecycle, reconciliation, payouts, and refunds. Postgres is the durable source of truth, Redis handles fast state and real-time coordination, and the wallet uses a ledger-based transactional design for correctness and auditability.
