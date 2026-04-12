#!/bin/sh
# Production entrypoint for the M+ API.
#
# Order of operations on every container start:
#   1. Apply any pending Prisma migrations (idempotent — `migrate deploy`
#      only applies new migrations, never prompts, never generates)
#   2. Run the reference-data seed (idempotent — upserts seasons +
#      dungeons by slug, safe to re-run)
#   3. Start the Fastify server
#
# The seed step guarantees a fresh deploy always has the active season
# + dungeon list populated, even if the DB was wiped.
set -e

cd /app/apps/api

echo "[entrypoint] applying Prisma migrations…"
npx prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] running reference-data seed (idempotent)…"
npx tsx prisma/seed.ts || {
  echo "[entrypoint] WARN: seed failed — continuing anyway (the API will still start)"
}

echo "[entrypoint] starting Fastify server on ${API_HOST:-0.0.0.0}:${API_PORT:-3001}"
exec npx tsx src/server.ts
