#!/bin/sh
# Production entrypoint for the M+ API.
#
# Order of operations on every container start:
#   0. Loud-fail if the DB looks like it lost its data dir (data-loss guardrail)
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

# Data-loss guardrail. If _prisma_migrations exists with applied rows but
# `users` is empty, the data dir was almost certainly lost (silent postgres
# re-init into an empty bind mount). Refusing to start prevents the API
# from happily serving a wiped DB and accepting fresh writes against it.
# Override with ALLOW_FRESH_INIT=1 for genuine first-run / restore-from-dump.
if [ "${ALLOW_FRESH_INIT:-0}" != "1" ]; then
  GUARD_OUTPUT=$(npx prisma db execute --schema prisma/schema.prisma --stdin <<'GUARD_SQL' 2>&1 || true
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations') AS has_migrations_table,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='users') AS has_users_table,
  (SELECT COALESCE((SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL), 0)) AS applied_migrations,
  (SELECT COALESCE((SELECT count(*) FROM users), 0)) AS user_count;
GUARD_SQL
  )
  # Best-effort parse: pull the four ints out. If parsing fails, fall
  # through (we'd rather start than block on a parser bug).
  APPLIED=$(echo "$GUARD_OUTPUT" | grep -oE '[0-9]+' | sed -n '3p')
  USERS=$(echo "$GUARD_OUTPUT" | grep -oE '[0-9]+' | sed -n '4p')
  if [ -n "$APPLIED" ] && [ -n "$USERS" ] && [ "$APPLIED" -ge 5 ] && [ "$USERS" = "0" ]; then
    echo "[entrypoint] FATAL: DB has $APPLIED applied migrations but 0 users."
    echo "[entrypoint] This pattern matches data-loss + silent postgres re-init."
    echo "[entrypoint] Refusing to start. Restore from /mnt/disk1/backups/mplus/ or set"
    echo "[entrypoint] ALLOW_FRESH_INIT=1 if this is a genuine first-run."
    exit 1
  fi
fi

echo "[entrypoint] applying Prisma migrations…"
npx prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] running reference-data seed (idempotent)…"
npx tsx prisma/seed.ts || {
  echo "[entrypoint] WARN: seed failed — continuing anyway (the API will still start)"
}

echo "[entrypoint] starting Fastify server on ${API_HOST:-0.0.0.0}:${API_PORT:-3001}"
exec npx tsx src/server.ts
