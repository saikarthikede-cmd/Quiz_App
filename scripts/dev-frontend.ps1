$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repoRoot "services\frontend"
$legacyDistDir = Join-Path $frontendRoot ".next"
$devDistDir = Join-Path $frontendRoot ".next-dev"

$frontendProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and
  $_.CommandLine -and
  $_.CommandLine -like "*services\\frontend*" -and
  $_.CommandLine -like "*next*" -and
  $_.CommandLine -like "*dev*"
}

if ($frontendProcesses) {
  $frontendProcesses | ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    } catch {
      # Ignore already-stopped frontend processes.
    }
  }
}

$frontendPortProcesses = Get-NetTCPConnection -State Listen -LocalPort 3000,3001,3002,3003,3004,3005 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($frontendPortProcesses) {
  foreach ($processId in $frontendPortProcesses) {
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
      if (
        $process -and
        $process.Name -eq "node.exe" -and
        $process.CommandLine -and
        $process.CommandLine -like "*services\\frontend*"
      ) {
        Stop-Process -Id $processId -Force -ErrorAction Stop
      }
    } catch {
      # Ignore already-stopped frontend processes.
    }
  }
}

Start-Sleep -Milliseconds 800

if (Test-Path $legacyDistDir) {
  Remove-Item -LiteralPath $legacyDistDir -Recurse -Force
}

if (Test-Path $devDistDir) {
  Remove-Item -LiteralPath $devDistDir -Recurse -Force
}

Set-Location $frontendRoot
pnpm dev
