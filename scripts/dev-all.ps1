$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $repoRoot "logs"

if (!(Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$services = @(
  @{
    Name = "quiz-api"
    Log = ".\logs\api-run.log"
    Command = "Set-Location '$repoRoot'; pnpm dev:api *>&1 | Tee-Object -FilePath '.\logs\api-run.log'"
  },
  @{
    Name = "quiz-game"
    Log = ".\logs\game-run.log"
    Command = "Set-Location '$repoRoot'; pnpm dev:game *>&1 | Tee-Object -FilePath '.\logs\game-run.log'"
  },
  @{
    Name = "quiz-worker"
    Log = ".\logs\worker-run.log"
    Command = "Set-Location '$repoRoot'; pnpm dev:worker *>&1 | Tee-Object -FilePath '.\logs\worker-run.log'"
  },
  @{
    Name = "quiz-frontend"
    Log = ".\logs\frontend-run.log"
    Command = "Set-Location '$repoRoot'; pnpm dev:frontend *>&1 | Tee-Object -FilePath '.\logs\frontend-run.log'"
  }
)

foreach ($service in $services) {
  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      $service.Command
    ) `
    -WorkingDirectory $repoRoot `
    -WindowStyle Minimized | Out-Null
}

Write-Host "Started api, game, worker, and frontend in separate PowerShell windows."
Write-Host "Frontend: http://127.0.0.1:3000"
Write-Host "API: http://127.0.0.1:4000/health"
Write-Host ""
Write-Host "Logs:"
Write-Host "  .\logs\api-run.log"
Write-Host "  .\logs\game-run.log"
Write-Host "  .\logs\worker-run.log"
Write-Host "  .\logs\frontend-run.log"
