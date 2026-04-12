#!/bin/sh
# Production entrypoint for the M+ API.
#
# Runs Prisma migrations against the live database before starting the
# Fastify server. Non-destructive — `migrate deploy` only applies
# migrations that haven't been applied yet; it never prompts and never
# generates new migrations.
set -e

cd /app/apps/api

echo "[entrypoint] applying Prisma migrations…"
npx prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] starting Fastify server on ${API_HOST:-0.0.0.0}:${API_PORT:-3001}"
exec npx tsx src/server.ts
