#!/bin/sh
# Production one-shot: migrations -> non-owner app role -> optional seed.
# Runs inside the API image as the `migrate` service (owner DATABASE_URL).
# Replaces fragile inline shell in docker-compose (quoting / $$ expansion bugs).
set -eu

cd "$(dirname "$0")/.."
echo "[migrate] working dir: $(pwd)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[migrate] ERROR: DATABASE_URL is not set (owner connection required)" >&2
  exit 1
fi
if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "[migrate] ERROR: APP_DB_PASSWORD is not set" >&2
  exit 1
fi

echo "[migrate] 1/3 prisma migrate deploy"
npx prisma migrate deploy

echo "[migrate] 2/3 apply non-owner app role (erp_app)"
# Node substitution: safe for any password characters (no sed delimiter issues)
node -e "const fs=require('fs');const sql=fs.readFileSync('prisma/app-role.sql','utf8').split('CHANGE_ME').join(process.env.APP_DB_PASSWORD);fs.writeFileSync('/tmp/app-role.sql',sql)"
npx prisma db execute --file /tmp/app-role.sql
rm -f /tmp/app-role.sql

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[migrate] 3/3 seed first tenant (RUN_SEED=true)"
  npm run seed
else
  echo "[migrate] 3/3 seed skipped (RUN_SEED != true)"
fi

echo "MIGRATIONS + APP ROLE OK"
