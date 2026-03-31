$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$localProcessMatchers = @(
  "*services\\api-server*",
  "*services\\game-server*",
  "*services\\worker-server*",
  "*services\\frontend*"
)

$nodeProcesses = Get-CimInstance Win32_Process | Where-Object {
  $commandLine = $_.CommandLine

  $_.Name -eq "node.exe" -and
  $commandLine -and
  (@($localProcessMatchers | Where-Object { $commandLine -like $_ }).Count -gt 0)
}

foreach ($process in $nodeProcesses) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  } catch {
    # Ignore already-exited processes.
  }
}

docker compose up --build -d

function Wait-ForUrl($url, $label, $timeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host "$label is ready at $url"
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "$label did not become ready in time: $url"
}

Wait-ForUrl "http://127.0.0.1:4000/health" "API"
Wait-ForUrl "http://127.0.0.1:3000" "Frontend"
Wait-ForUrl "http://127.0.0.1:4001/socket.io/?EIO=4&transport=polling" "Game server"

Write-Host ""
Write-Host "Docker app is ready:"
Write-Host "Frontend: http://127.0.0.1:3000"
Write-Host "API:      http://127.0.0.1:4000/health"
Write-Host "Socket:   http://127.0.0.1:4001/socket.io/?EIO=4&transport=polling"
