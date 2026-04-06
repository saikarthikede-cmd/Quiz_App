$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$apiBaseUrl = "http://127.0.0.1:4000"
$frontendUrl = "http://127.0.0.1:3000"
$gamePollingUrl = "http://127.0.0.1:4001/socket.io/?EIO=4&transport=polling"
$defaultTenant = "default"
$acmeTenant = "acme-$([Guid]::NewGuid().ToString('N').Substring(0, 6))"
$acmeTenantName = "Acme Corp $([Guid]::NewGuid().ToString('N').Substring(0, 4))"
$defaultAdminEmail = if ($env:ADMIN_EMAIL) { $env:ADMIN_EMAIL } else { "saikarthik.ede@fissionlabs.com" }
$defaultPlayerEmail = "default.player.$([Guid]::NewGuid().ToString('N').Substring(0, 8))@example.com"
$acmeAdminEmail = "tenant.admin.$([Guid]::NewGuid().ToString('N').Substring(0, 8))@example.com"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
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

function Invoke-JsonRequest($method, $uri, $body = $null, $headers = @{}) {
  $params = @{
    Uri         = $uri
    Method      = $method
    Headers     = $headers
    ContentType = "application/json"
  }

  if ($null -ne $body) {
    $params.Body = ($body | ConvertTo-Json -Compress)
  }

  Invoke-RestMethod @params
}

function Invoke-JsonGet($uri, $headers = @{}) {
  Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
}

function New-TestSession($email, $name, $tenantSlug = "default", $forceAdmin = $false, $forcePlatformAdmin = $false, $minimumBalance = 0) {
  $raw = docker exec `
    -e TEST_EMAIL=$email `
    -e TEST_NAME=$name `
    -e TEST_TENANT_SLUG=$tenantSlug `
    -e TEST_FORCE_ADMIN=$(if ($forceAdmin) { "true" } else { "false" }) `
    -e TEST_FORCE_PLATFORM_ADMIN=$(if ($forcePlatformAdmin) { "true" } else { "false" }) `
    -e TEST_MIN_BALANCE=$minimumBalance `
    quiz-app-api `
    sh -lc "cd /app && pnpm test:create-session"

  if ($LASTEXITCODE -ne 0) {
    throw "test:create-session failed with exit code $LASTEXITCODE"
  }

  $json = ($raw | Where-Object { $_ -and $_.Trim().StartsWith("{") } | Select-Object -Last 1)
  if (-not $json) {
    throw "test:create-session did not return JSON"
  }

  return ($json | ConvertFrom-Json)
}

function New-TenantHeaders($tenantSlug, $accessToken = $null) {
  $headers = @{ "x-tenant-slug" = $tenantSlug }
  if ($accessToken) {
    $headers.Authorization = "Bearer $accessToken"
  }
  return $headers
}

Write-Step "Checking Docker app readiness"
Wait-ForReady "$apiBaseUrl/health" "API"
Wait-ForReady $frontendUrl "Frontend"
Wait-ForReady $gamePollingUrl "Game server"

Write-Step "Creating default-tenant platform admin session"
$defaultAdminLogin = New-TestSession $defaultAdminEmail "Default Platform Admin" $defaultTenant $true $true 0
$defaultAdminHeaders = New-TenantHeaders $defaultTenant $defaultAdminLogin.access_token

if (-not $defaultAdminLogin.user.is_platform_admin) {
  throw "Default tenant admin is not a platform admin, so tenant provisioning cannot be verified."
}

Write-Step "Provisioning a second tenant"
$tenantResult = Invoke-JsonRequest "POST" "$apiBaseUrl/admin/tenants" @{
  name = $acmeTenantName
  slug = $acmeTenant
  plan = "pro"
} $defaultAdminHeaders
$allTenants = Invoke-JsonGet "$apiBaseUrl/admin/tenants" $defaultAdminHeaders

if (-not ($allTenants.tenants | Where-Object { $_.slug -eq $acmeTenant })) {
  throw "New tenant was not returned by /admin/tenants."
}

Write-Host "Provisioned tenant slug: $acmeTenant"

Write-Step "Creating tenant-scoped users"
$defaultPlayerLogin = New-TestSession $defaultPlayerEmail "Default Tenant Player" $defaultTenant $false $false 100
$defaultPlayerHeaders = New-TenantHeaders $defaultTenant $defaultPlayerLogin.access_token

$acmeAdminLogin = New-TestSession $acmeAdminEmail "Acme Tenant Admin" $acmeTenant $true $false 0
$acmeAdminHeaders = New-TenantHeaders $acmeTenant $acmeAdminLogin.access_token

if (-not $acmeAdminLogin.user.is_admin) {
  throw "Acme tenant admin bootstrap did not receive admin access."
}

Write-Step "Creating and publishing tenant-specific contests"
$defaultStartsAt = [DateTime]::UtcNow.AddMinutes(8).ToString("yyyy-MM-ddTHH:mm:ssZ")
$defaultContest = Invoke-JsonRequest "POST" "$apiBaseUrl/admin/contests" @{
  title       = "Default Tenant Isolation $(Get-Date -Format 'HHmmss')"
  starts_at   = $defaultStartsAt
  entry_fee   = 10
  max_members = 25
  prize_rule  = "all_correct"
} $defaultAdminHeaders
$defaultContestId = $defaultContest.contest.id

Invoke-JsonRequest "POST" "$apiBaseUrl/admin/contests/$defaultContestId/questions" @{
  seq            = 1
  body           = "Which number is even?"
  option_a       = "3"
  option_b       = "4"
  option_c       = "5"
  option_d       = "7"
  correct_option = "b"
  time_limit_sec = 15
} $defaultAdminHeaders | Out-Null

Invoke-JsonRequest "POST" "$apiBaseUrl/admin/contests/$defaultContestId/publish" @{} $defaultAdminHeaders | Out-Null

$acmeStartsAt = [DateTime]::UtcNow.AddMinutes(9).ToString("yyyy-MM-ddTHH:mm:ssZ")
$acmeContest = Invoke-JsonRequest "POST" "$apiBaseUrl/admin/contests" @{
  title       = "Acme Tenant Isolation $(Get-Date -Format 'HHmmss')"
  starts_at   = $acmeStartsAt
  entry_fee   = 10
  max_members = 25
  prize_rule  = "all_correct"
} $acmeAdminHeaders
$acmeContestId = $acmeContest.contest.id

Invoke-JsonRequest "POST" "$apiBaseUrl/admin/contests/$acmeContestId/questions" @{
  seq            = 1
  body           = "Sky color?"
  option_a       = "Blue"
  option_b       = "Red"
  option_c       = "Green"
  option_d       = "Black"
  correct_option = "a"
  time_limit_sec = 15
} $acmeAdminHeaders | Out-Null

Invoke-JsonRequest "POST" "$apiBaseUrl/admin/contests/$acmeContestId/publish" @{} $acmeAdminHeaders | Out-Null

Write-Step "Verifying public contest isolation"
$defaultContests = Invoke-JsonGet "$apiBaseUrl/contests" (New-TenantHeaders $defaultTenant)
$acmeContests = Invoke-JsonGet "$apiBaseUrl/contests" (New-TenantHeaders $acmeTenant)

if (-not ($defaultContests.contests | Where-Object { $_.id -eq $defaultContestId })) {
  throw "Default tenant open contests did not include its own contest."
}

if ($defaultContests.contests | Where-Object { $_.id -eq $acmeContestId }) {
  throw "Default tenant open contests leaked Acme contest."
}

if (-not ($acmeContests.contests | Where-Object { $_.id -eq $acmeContestId })) {
  throw "Acme tenant open contests did not include its own contest."
}

if ($acmeContests.contests | Where-Object { $_.id -eq $defaultContestId }) {
  throw "Acme tenant open contests leaked default tenant contest."
}

Write-Step "Verifying join isolation"
$joinBlocked = $false
try {
  Invoke-JsonRequest "POST" "$apiBaseUrl/contests/$defaultContestId/join" @{} $acmeAdminHeaders | Out-Null
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -eq 404 -or $statusCode -eq 409) {
    $joinBlocked = $true
  } else {
    throw
  }
}

if (-not $joinBlocked) {
  throw "Cross-tenant join unexpectedly succeeded."
}

$defaultJoin = Invoke-JsonRequest "POST" "$apiBaseUrl/contests/$defaultContestId/join" @{} $defaultPlayerHeaders
if (-not $defaultJoin.success) {
  throw "Default tenant user could not join default tenant contest."
}

Write-Step "Verifying admin list isolation"
$defaultUsers = Invoke-JsonGet "$apiBaseUrl/admin/users" $defaultAdminHeaders
$acmeUsers = Invoke-JsonGet "$apiBaseUrl/admin/users" $acmeAdminHeaders
$defaultAdminContests = Invoke-JsonGet "$apiBaseUrl/admin/contests" $defaultAdminHeaders
$acmeAdminContests = Invoke-JsonGet "$apiBaseUrl/admin/contests" $acmeAdminHeaders

if (-not ($defaultUsers.users | Where-Object { $_.email -eq $defaultPlayerEmail })) {
  throw "Default tenant admin view did not include default tenant player."
}

if ($defaultUsers.users | Where-Object { $_.email -eq $acmeAdminEmail }) {
  throw "Default tenant admin view leaked Acme user."
}

if (-not ($acmeUsers.users | Where-Object { $_.email -eq $acmeAdminEmail })) {
  throw "Acme admin view did not include Acme user."
}

if ($acmeUsers.users | Where-Object { $_.email -eq $defaultPlayerEmail }) {
  throw "Acme admin view leaked default tenant user."
}

if (-not ($defaultAdminContests.contests | Where-Object { $_.id -eq $defaultContestId })) {
  throw "Default tenant admin contests did not include default tenant contest."
}

if ($defaultAdminContests.contests | Where-Object { $_.id -eq $acmeContestId }) {
  throw "Default tenant admin contests leaked Acme contest."
}

if (-not ($acmeAdminContests.contests | Where-Object { $_.id -eq $acmeContestId })) {
  throw "Acme admin contests did not include Acme contest."
}

if ($acmeAdminContests.contests | Where-Object { $_.id -eq $defaultContestId }) {
  throw "Acme admin contests leaked default tenant contest."
}

Write-Step "Verifying direct cross-tenant contest access is blocked"
$leaderboardBlocked = $false
try {
  Invoke-JsonGet "$apiBaseUrl/contests/$defaultContestId/leaderboard" (New-TenantHeaders $acmeTenant) | Out-Null
} catch {
  $statusCode = [int]$_.Exception.Response.StatusCode
  if ($statusCode -eq 404) {
    $leaderboardBlocked = $true
  } else {
    throw
  }
}

if (-not $leaderboardBlocked) {
  throw "Cross-tenant leaderboard access was not blocked."
}

Write-Step "Cross-tenant verification completed"
Write-Host "Tenant slug:        $acmeTenant"
Write-Host "Default contest id: $defaultContestId"
Write-Host "Acme contest id:    $acmeContestId"
