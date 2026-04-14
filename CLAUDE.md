# M+ Challenge Platform — Claude Code Instructions

## Repository
- **Repo:** https://github.com/hitf5now/mkeytracker
- **Structure:** npm workspaces monorepo
  - `addon/MKeyTracker/` — WoW Lua addon (Interface 120001, Midnight 12.0)
  - `apps/companion/` — Electron desktop app (SV parser, file watcher, API client)
  - `apps/api/` — Fastify 5 + Prisma + PostgreSQL
  - `apps/bot/` — Discord.js 14 bot
  - `apps/web/` — Next.js website
  - `packages/types/` — shared TypeScript interfaces
  - `packages/wow-constants/` — class/spec/role data

## GitHub CLI
`gh` is installed (`winget install GitHub.cli`). Use it for creating releases, PRs, etc.
- Create releases: `gh release create v0.X.0 --title "..." --notes "..." --latest`
- If `gh` isn't on PATH, use GitHub REST API via Node.js with git credential manager token:
  ```bash
  token=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | grep "^password=" | sed 's/password=//')
  ```

## Key Conventions
- **Env loading:** All workspace scripts must wrap with `dotenv -e ../../.env --` (dotenv-cli)
- **Addon versioning:** Always bump TOC `## Version`, `ns.version`, and companion `package.json` together
- **luaparse:** Always set `encodingMode: "pseudo-latin1"` or StringLiteral.value is null
- **WoW protected actions:** Never wrap ReloadUI or protected APIs in C_Timer.After from a button handler
- **Electron builds:** Runtime packages MUST be in `dependencies`, not `devDependencies` (electron-builder prunes devDeps)
- **Spec field:** Never auto-set spec from RaiderIO/addon data; class auto-sets but spec is always a user dropdown choice
- **Companion not required:** Manual entry always available; companion is recommended not gatekept

## Infrastructure
- **Server:** Unraid at 192.168.1.4 (PostgreSQL 15, Redis, Nginx Proxy Manager)
- **Deploy:** Docker containers on Unraid; use the unraid-server-manager agent for deployments
