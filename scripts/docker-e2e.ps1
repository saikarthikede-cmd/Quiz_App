$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$apiBaseUrl = "http://127.0.0.1:4000"
$frontendUrl = "http://127.0.0.1:3000"
$gamePollingUrl = "http://127.0.0.1:4001/socket.io/?EIO=4&transport=polling"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Invoke-JsonPost($uri, $body, $headers = @{}) {
  Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress)
}

function Wait-ForReady($uri, $label, $timeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "$label ready -> $uri"
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "$label did not become ready in time: $uri"
}

Write-Step "Checking Docker app readiness"
Wait-ForReady "$apiBaseUrl/health" "API"
Wait-ForReady $frontendUrl "Frontend"
Wait-ForReady $gamePollingUrl "Game server"

Write-Step "Creating admin session"
$adminLogin = Invoke-JsonPost "$apiBaseUrl/auth/dev-login" @{
  email = "saikarthik.ede@fissionlabs.com"
  name = "Admin User"
}
$adminHeaders = @{ Authorization = "Bearer $($adminLogin.access_token)" }

Write-Step "Creating fresh contest"
$startsAt = [DateTime]::UtcNow.AddSeconds(35).ToString("yyyy-MM-ddTHH:mm:ssZ")
$contest = Invoke-JsonPost "$apiBaseUrl/admin/contests" @{
  title = "Docker Demo Validation $(Get-Date -Format 'yyyyMMdd-HHmmss')"
  starts_at = $startsAt
  entry_fee = 10
  max_members = 100
  prize_rule = "all_correct"
} $adminHeaders
$contestId = $contest.contest.id
Write-Host "Contest created: $contestId"

Write-Step "Adding contest questions"
Invoke-JsonPost "$apiBaseUrl/admin/contests/$contestId/questions" @{
  seq = 1
  body = "2 + 2 = ?"
  option_a = "3"
  option_b = "4"
  option_c = "5"
  option_d = "6"
  correct_option = "b"
  time_limit_sec = 5
} $adminHeaders | Out-Null

Invoke-JsonPost "$apiBaseUrl/admin/contests/$contestId/questions" @{
  seq = 2
  body = "Capital of India?"
  option_a = "Mumbai"
  option_b = "New Delhi"
  option_c = "Chennai"
  option_d = "Pune"
  correct_option = "b"
  time_limit_sec = 5
} $adminHeaders | Out-Null

Write-Step "Publishing contest"
Invoke-JsonPost "$apiBaseUrl/admin/contests/$contestId/publish" @{} $adminHeaders | Out-Null

Write-Step "Joining player to contest"
$playerLogin = Invoke-JsonPost "$apiBaseUrl/auth/dev-login" @{
  email = "player.one@gmail.com"
  name = "Player One"
}
$playerHeaders = @{ Authorization = "Bearer $($playerLogin.access_token)" }
$joinResult = Invoke-JsonPost "$apiBaseUrl/contests/$contestId/join" @{} $playerHeaders
Write-Host ("Join success: {0} | prize pool: Rs {1} | wallet: Rs {2}" -f $joinResult.success, $joinResult.prize_pool, $joinResult.wallet_balance)

Write-Step "Running live socket flow"
$previousEnv = @{
  API_BASE_URL = $env:API_BASE_URL
  GAME_BASE_URL = $env:GAME_BASE_URL
  TEST_EMAIL = $env:TEST_EMAIL
  TEST_NAME = $env:TEST_NAME
  TEST_CONTEST_ID = $env:TEST_CONTEST_ID
  TEST_ANSWERS = $env:TEST_ANSWERS
}

try {
  $env:API_BASE_URL = $apiBaseUrl
  $env:GAME_BASE_URL = "http://127.0.0.1:4001"
  $env:TEST_EMAIL = "player.one@gmail.com"
  $env:TEST_NAME = "Player One"
  $env:TEST_CONTEST_ID = $contestId
  $env:TEST_ANSWERS = "b,b"

  pnpm test:socket-client
  if ($LASTEXITCODE -ne 0) {
    throw "Socket E2E client failed with exit code $LASTEXITCODE"
  }
} finally {
  foreach ($key in $previousEnv.Keys) {
    if ($null -eq $previousEnv[$key]) {
      Remove-Item "Env:$key" -ErrorAction SilentlyContinue
    } else {
      Set-Item "Env:$key" $previousEnv[$key]
    }
  }
}

Write-Step "Verifying leaderboard"
$leaderboard = Invoke-RestMethod -Uri "$apiBaseUrl/contests/$contestId/leaderboard" -Method Get
$winner = $leaderboard.leaderboard | Select-Object -First 1

if (-not $winner) {
  throw "Leaderboard did not return any winner rows"
}

Write-Host ("Winner: {0} | score: {1} | prize: Rs {2}" -f $winner.name, $winner.correct_count, $winner.prize_amount)

Write-Step "Docker E2E completed"
Write-Host "Contest id: $contestId"
Write-Host "Frontend:   $frontendUrl"
Write-Host "API:        $apiBaseUrl/health"
