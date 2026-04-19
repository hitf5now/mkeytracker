#!/usr/bin/env bash
# deploy-api.sh — rebuild and redeploy the mplus-api container on Unraid.
#
# Usage: bash scripts/deploy-api.sh [--force]
#
# Without --force, the script aborts if the server working tree has any
# untracked or modified files under apps/api/, packages/, or the root
# package files. This prevents silent drift between what git HEAD says
# and what actually gets built into the image (the exact bug that caused
# totalOverhealing to silently store 0 in production).
#
# With --force, the clean-tree check is skipped (emergency use only).
#
set -euo pipefail

SERVER="root@192.168.1.4"
SOURCE_DIR="/mnt/user/appdata/mplus-platform/source"
COMPOSE_FILE="docker-compose.prod.yml"
SERVICE="api"
FORCE=0

for arg in "$@"; do
  [[ "$arg" == "--force" ]] && FORCE=1
done

echo "[deploy-api] Pulling latest from origin/main ..."
ssh "$SERVER" "cd $SOURCE_DIR && git pull origin main"

REMOTE_HEAD=$(ssh "$SERVER" "cd $SOURCE_DIR && git rev-parse HEAD")
echo "[deploy-api] Server HEAD: $REMOTE_HEAD"

if [[ $FORCE -eq 0 ]]; then
  echo "[deploy-api] Checking for working-tree drift ..."

  # Any untracked or modified files in source paths we care about.
  DIRTY=$(ssh "$SERVER" "cd $SOURCE_DIR && git status --porcelain -- \
    apps/api/ \
    packages/ \
    package.json \
    package-lock.json \
    tsconfig.base.json" 2>/dev/null)

  if [[ -n "$DIRTY" ]]; then
    echo ""
    echo "ERROR: Server working tree has uncommitted changes that would be"
    echo "       baked into the Docker image but are NOT in git:"
    echo ""
    echo "$DIRTY"
    echo ""
    echo "Fix: either commit + push those files, delete them, or re-run"
    echo "     with --force to skip this check (emergency only)."
    exit 1
  fi

  echo "[deploy-api] Working tree is clean."
fi

echo "[deploy-api] Building image with --no-cache ..."
OLD_IMAGE=$(ssh "$SERVER" "docker inspect mplus-api --format '{{.Image}}' 2>/dev/null || echo none")

ssh "$SERVER" "cd $SOURCE_DIR && docker-compose -f $COMPOSE_FILE build --no-cache $SERVICE"

echo "[deploy-api] Recreating container ..."
ssh "$SERVER" "cd $SOURCE_DIR && docker-compose -f $COMPOSE_FILE up -d --no-deps $SERVICE"

NEW_IMAGE=$(ssh "$SERVER" "docker inspect mplus-api --format '{{.Image}}' 2>/dev/null")

echo ""
echo "[deploy-api] Done."
echo "  Old image: $OLD_IMAGE"
echo "  New image: $NEW_IMAGE"
echo "  HEAD:      $REMOTE_HEAD"

if [[ "$OLD_IMAGE" == "$NEW_IMAGE" ]]; then
  echo ""
  echo "WARNING: Image ID did not change. The build may have used a cached"
  echo "         layer. Re-run with --no-cache if you suspect stale output."
fi
