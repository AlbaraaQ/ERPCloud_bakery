# ERPCloud — one-command production run (Windows PowerShell)
# Usage:  .\run-production.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env.production")) {
    Write-Host "Creating .env.production from template - EDIT IT FIRST, then run again." -ForegroundColor Yellow
    Copy-Item ".env.production.example" ".env.production"
    exit 1
}
if (Select-String -Path ".env.production" -Pattern "CHANGE_ME" -Quiet) {
    Write-Host ".env.production still contains CHANGE_ME placeholders - fill every value (openssl rand -hex 32 for secrets), then run again." -ForegroundColor Red
    exit 1
}

Write-Host "Building and starting the production stack..." -ForegroundColor Cyan
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "--- migrate logs (root cause is here) ---" -ForegroundColor Red
    docker compose -f docker-compose.prod.yml --env-file .env.production logs migrate
    exit 1
}

Write-Host "--- migrate result ---"
docker compose -f docker-compose.prod.yml --env-file .env.production logs migrate | Select-Object -Last 5
Write-Host "--- health checks ---"
try { (Invoke-WebRequest -UseBasicParsing http://localhost:3001/api/v1/health).Content } catch { Write-Host "API health failed: $_" -ForegroundColor Red }
try { (Invoke-WebRequest -UseBasicParsing http://localhost:8080/).StatusCode } catch { Write-Host "Web failed: $_" -ForegroundColor Red }
Write-Host "Open http://localhost:8080 and log in with SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD from .env.production" -ForegroundColor Green
