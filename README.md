# Quiz App Monorepo

Production-oriented real-time quiz platform with:

- `services/api-server`: Fastify HTTP API
- `services/game-server`: Socket.io live gameplay server
- `services/worker-server`: BullMQ lifecycle and payout worker
- `services/frontend`: Next.js frontend
- `packages/db`, `packages/redis`, `packages/queues`, `packages/types`: shared packages

## Current local auth/payment mode

The app uses Google OAuth for real user sign-in and a manual admin-reviewed add-money flow for wallet top-ups:

- Google sign-in is handled through `POST /auth/google`
- Wallet top-ups are requested through `POST /wallet/add-money` and reviewed by an admin

For automated local verification, the repo also includes an internal test-session helper used by the Docker E2E scripts. That helper is for automation only and is not part of the public app flow.

## Prerequisites

- Node.js `24.x`
- pnpm `10.x`
- Docker Desktop
- PowerShell

## Local ports

- Frontend: `http://localhost:3000`
- API: `http://localhost:4000`
- Game server: `http://localhost:4001`
- Postgres: `localhost:5432`
- Redis: `localhost:6380`

`6380` is used because another local project already occupies Redis `6379`.

## First-time setup

```powershell
cd C:\Users\FL_LPT-573\Desktop\QUIZ-APP
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm -r build
```

## One-command clean reset

```powershell
cd C:\Users\FL_LPT-573\Desktop\QUIZ-APP
pnpm reset:local
```

This will:

- stop Docker containers
- remove local Postgres/Redis volumes
- start fresh containers
- install dependencies
- run migrations
- seed demo data
- rebuild the workspace

## Run the full stack

Open four terminals from the project root.

Terminal 1:

```powershell
pnpm dev:api
```

Terminal 2:

```powershell
pnpm dev:game
```

Terminal 3:

```powershell
pnpm dev:worker
```

Terminal 4:

```powershell
pnpm dev:frontend
```

## One-command local startup

If you do not want to open four terminals manually, use:

```powershell
cd C:\Users\FL_LPT-573\Desktop\QUIZ-APP
pnpm dev:all
```

This opens the API, game server, worker, and frontend in separate PowerShell windows and writes logs to:

- `.\logs\api-run.log`
- `.\logs\game-run.log`
- `.\logs\worker-run.log`
- `.\logs\frontend-run.log`

## One-command Docker startup

If you want to run everything through Docker only:

```powershell
cd C:\Users\FL_LPT-573\Desktop\QUIZ-APP
pnpm docker:app:up
```

This builds and starts the full Docker stack, then waits until frontend, API, and game server are reachable.

## One-command Docker E2E validation

Run this before demos when you want a full create -> publish -> join -> live score -> leaderboard check:

```powershell
cd C:\Users\FL_LPT-573\Desktop\QUIZ-APP
pnpm docker:app:e2e
```

This script will:

- verify Docker services are reachable
- create a fresh contest
- add 2 questions
- publish it
- join `player.one@gmail.com`
- run the socket test client with scripted correct answers
- verify the final leaderboard

## Quick health checks

```powershell
Invoke-RestMethod http://localhost:4000/health
Test-NetConnection localhost -Port 4000
Test-NetConnection localhost -Port 4001
Test-NetConnection localhost -Port 5432
Test-NetConnection localhost -Port 6380
Test-NetConnection localhost -Port 3000
```

## Demo users

- the first user created inside a tenant becomes that tenant admin
- any other Google-authenticated user in the same tenant can join as a player

## API smoke test

```powershell
pnpm docker:app:smoke
```

## Admin contest flow

```powershell
pnpm docker:app:e2e
```

## Socket gameplay test

Use a fresh contest that starts in the next 2 minutes.

Terminal A:

```powershell
$env:TEST_EMAIL='demo.player.one@example.com'
$env:TEST_NAME='Demo Player One'
$env:TEST_CONTEST_ID='<contest-id>'
$env:TEST_ANSWERS='b,b'
pnpm test:socket-client
```

Terminal B:

```powershell
$env:TEST_EMAIL='demo.player.two@example.com'
$env:TEST_NAME='Demo Player Two'
$env:TEST_CONTEST_ID='<contest-id>'
$env:TEST_ANSWERS='b,a'
pnpm test:socket-client
```

After contest end:

```powershell
Invoke-RestMethod http://localhost:4000/contests/<contest-id>/leaderboard
```

## Useful DB checks

```powershell
$env:PGPASSWORD='Karthik'
psql -P pager=off -h localhost -p 5432 -U postgres -d quiz_app -c "SELECT id,title,status,member_count,current_q,starts_at,ended_at FROM contests ORDER BY created_at DESC;"
psql -P pager=off -h localhost -p 5432 -U postgres -d quiz_app -c "SELECT contest_id,user_id,is_winner,prize_amount FROM contest_members ORDER BY joined_at DESC;"
psql -P pager=off -h localhost -p 5432 -U postgres -d quiz_app -c "SELECT user_id,type,reason,amount,balance_before,balance_after,reference_id FROM wallet_transactions ORDER BY created_at DESC;"
```

## Frontend scope right now

The frontend is integrated against the existing backend and is intentionally starting with:

- email-based temp login
- wallet balance and add-money flow
- contest discovery and join
- admin contest create/publish workflow
- leaderboard viewing
- live contest page shell connected to the game server

Google OAuth and a real payment gateway should be swapped in later once credentials are available.
