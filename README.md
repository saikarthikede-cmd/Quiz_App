# Quiz App Monorepo

Production-oriented real-time quiz platform with:

- `services/api-server`: Fastify HTTP API
- `services/game-server`: Socket.io live gameplay server
- `services/worker-server`: BullMQ lifecycle and payout worker
- `services/frontend`: Next.js frontend
- `packages/db`, `packages/redis`, `packages/queues`, `packages/types`: shared packages

## Current local auth/payment mode

Two temporary backend substitutions are active until company credentials are available:

- Google OAuth is temporarily replaced by email-based login at `POST /auth/dev-login`
- Payment gateway top-up is temporarily replaced by `POST /wallet/add-money`

Both substitutions are clearly commented in code and should be swapped later without changing the rest of the backend contract.

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

- `admin.quiz@gmail.com`
- `player.one@gmail.com`
- `player.two@gmail.com`

## API smoke test

```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$login = Invoke-RestMethod `
  -Uri 'http://localhost:4000/auth/dev-login' `
  -Method Post `
  -WebSession $session `
  -ContentType 'application/json' `
  -Body '{"email":"player.one@gmail.com","name":"Player One"}'

$headers = @{ Authorization = "Bearer $($login.access_token)" }

Invoke-RestMethod `
  -Uri 'http://localhost:4000/wallet/balance' `
  -Method Get `
  -Headers $headers

Invoke-RestMethod `
  -Uri 'http://localhost:4000/wallet/add-money' `
  -Method Post `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body '{"amount":50}'

Invoke-RestMethod http://localhost:4000/contests
```

## Admin contest flow

```powershell
$admin = Invoke-RestMethod `
  -Uri 'http://localhost:4000/auth/dev-login' `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"admin.quiz@gmail.com","name":"Quiz Admin"}'

$adminHeaders = @{ Authorization = "Bearer $($admin.access_token)" }
$startsAt = (Get-Date).ToUniversalTime().AddMinutes(2).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$contestBody = @{
  title = "Restart Live Test"
  starts_at = $startsAt
  entry_fee = 10
  max_members = 100
  prize_rule = "all_correct"
} | ConvertTo-Json

$contest = Invoke-RestMethod `
  -Uri 'http://localhost:4000/admin/contests' `
  -Method Post `
  -Headers $adminHeaders `
  -ContentType 'application/json' `
  -Body $contestBody

$contestId = $contest.contest.id

Invoke-RestMethod `
  -Uri "http://localhost:4000/admin/contests/$contestId/questions" `
  -Method Post `
  -Headers $adminHeaders `
  -ContentType 'application/json' `
  -Body '{"seq":1,"body":"Capital of India?","option_a":"Mumbai","option_b":"New Delhi","option_c":"Chennai","option_d":"Kolkata","correct_option":"b","time_limit_sec":15}'

Invoke-RestMethod `
  -Uri "http://localhost:4000/admin/contests/$contestId/questions" `
  -Method Post `
  -Headers $adminHeaders `
  -ContentType 'application/json' `
  -Body '{"seq":2,"body":"2 + 2 = ?","option_a":"3","option_b":"4","option_c":"5","option_d":"6","correct_option":"b","time_limit_sec":15}'

Invoke-RestMethod `
  -Uri "http://localhost:4000/admin/contests/$contestId/publish" `
  -Method Post `
  -Headers $adminHeaders `
  -ContentType 'application/json' `
  -Body '{}'
```

## Socket gameplay test

Use a fresh contest that starts in the next 2 minutes.

Terminal A:

```powershell
$env:TEST_EMAIL='player.one@gmail.com'
$env:TEST_NAME='Player One'
$env:TEST_CONTEST_ID='<contest-id>'
$env:TEST_ANSWERS='b,b'
pnpm test:socket-client
```

Terminal B:

```powershell
$env:TEST_EMAIL='player.two@gmail.com'
$env:TEST_NAME='Player Two'
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
