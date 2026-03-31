$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Container status"
docker compose ps

Write-Host ""
Write-Host "API health"
Invoke-RestMethod "http://127.0.0.1:4000/health" | ConvertTo-Json -Compress

Write-Host ""
Write-Host "Frontend"
(Invoke-WebRequest "http://127.0.0.1:3000" -UseBasicParsing | Select-Object StatusCode, StatusDescription | ConvertTo-Json -Compress)

Write-Host ""
Write-Host "Socket polling endpoint"
(Invoke-WebRequest "http://127.0.0.1:4001/socket.io/?EIO=4&transport=polling" -UseBasicParsing | Select-Object StatusCode | ConvertTo-Json -Compress)

Write-Host ""
Write-Host "Google config"
Invoke-RestMethod "http://127.0.0.1:4000/auth/google/config" | ConvertTo-Json -Compress
