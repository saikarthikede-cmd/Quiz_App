$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repoRoot "services\frontend"
$legacyDistDir = Join-Path $frontendRoot ".next"
$devDistDir = Join-Path $frontendRoot ".next-dev"

if (Test-Path $legacyDistDir) {
  Remove-Item -LiteralPath $legacyDistDir -Recurse -Force
}

if (Test-Path $devDistDir) {
  Remove-Item -LiteralPath $devDistDir -Recurse -Force
}

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

Set-Location $frontendRoot
pnpm dev
