# Conversation Log: M+ Challenge Platform - Comprehensive Session Summary

**Date**: 2026-04-11
**Session Duration**: Extended multi-sprint development session
**Primary Topics**: Full-stack WoW M+ tracker platform, Discord integration, WoW addon, Electron companion app, leaderboards, production deployment

## Summary

Completed comprehensive development of the M+ Challenge Platform (mkeytracker), a World of Warcraft Mythic+ keystones tracker with Discord bot integration, in-game WoW addon, Electron companion CLI/app, and full leaderboard system. All infrastructure, APIs, bot features, addon capture system, companion app, and production deployment were completed across 5+ sprints. Platform is live on mythicplustracker.com with active Discord bot and GitHub releases.

## Repository Details

- **Repository**: https://github.com/hitf5now/mkeytracker (public)
- **Primary Domain**: mythicplustracker.com (Cloudflare proxied, Let's Encrypt SSL via DNS-01)
- **API Endpoint**: https://api.mythicplustracker.com (Nginx Proxy Manager → Unraid 192.168.1.4:3020)
- **GitHub Releases**: v0.1.0, v0.1.1, v0.1.2, v0.1.3 (Windows NSIS installers)

## Key Decisions

- **Monorepo architecture**: npm workspaces with separate apps (api, bot, companion) and shared packages (types, wow-constants) for DRY principles and type safety
- **PostgreSQL + Redis**: PostgreSQL 16 for persistent state (runs, users, seasons), Redis 7 for caching/JWT pairing flow
- **Dual authentication**: Internal bearer tokens (bot-to-API) for automated systems, JWT flow for Electron companion app (user-driven)
- **Client-side dedup**: WoW addon and companion app both compute SHA256 hash of run details to prevent duplicate submissions
- **Discord webhook embeds**: Fire-and-forget announcements to #results channel on run submission (async, no response needed)
- **RaiderIO integration**: Character validation via HTTP client; handles 400 response for missing characters (not 404)
- **Protected action lesson**: ReloadUI cannot be called from C_Timer.After callback; must be called directly from slash command handler in WoW Midnight
- **Production infrastructure**: Docker containers for API + bot on Unraid with docker-compose.prod.yml, Nginx Proxy Manager reverse proxy, automatic Prisma migrations on container start

## Technical Details

### Sprint 1 — Infrastructure

**Monorepo Setup**:
- Root `package.json` with workspaces: `apps/api`, `apps/bot`, `apps/companion`, `packages/types`, `packages/wow-constants`
- TypeScript strict mode (`"strict": true`) across all workspaces
- Shared Prisma schema in packages for type generation

**Database Schema (Prisma)**:
```
- seasons (id, slug, active)
- dungeons (id, name, short_name, region, season)
- users (id, discord_id, created_at)
- characters (id, user_id, name, realm, region, class, spec, role, rio_score)
- runs (id, hash SHA256, season, dungeon, time_ms, level, score, created_at, metadata)
- run_members (run_id, character_id, role, class, spec)
- telemetry_events (id, user_id, event_type, payload, created_at)
```

**Docker Compose (Local Dev)**:
```yaml
postgres:
  image: postgres:16
  environment:
    POSTGRES_PASSWORD: ${DB_PASSWORD}
redis:
  image: redis:7
```

**CI/CD**: GitHub Actions workflow for testing and builds on push

### Sprint 1.5 — API + Bot MVP

**Discord Bot Commands**:
- `/register` — upserts user + character via RaiderIO API lookup, displays valid roles per class
- `/link` — initiates JWT pairing flow
- `/ping` — health check

**Fastify 5 API**:
- Health check endpoint: `GET /health`
- `POST /api/v1/register` — accepts RaiderIO character lookup parameters, creates user + character record
- Internal authentication via pre-shared `Authorization: Bearer <API_INTERNAL_SECRET>` token between bot and API

**RaiderIO HTTP Client**:
- Queries `https://raider.io/api/v1/characters` with character name, realm, region
- Handles 400 response (character not found, not 404)
- Extracts class, spec, role, talent tree, and current season Rio score

### Sprint 1.75 — Scoring + Run Submission

**Scoring Formula**:
```
base_points = 100
time_modifier = 1.0 (baseline; scales down if over time cap)
no_death_bonus = 10 if deaths == 0
pr_bonus = 50 if new highest key for dungeon
event_bonus = 20 if event submission
score = base_points * time_modifier + bonuses
```

**Run Submission**:
- `POST /api/v1/runs` with request body containing run details (dungeon, level, time, members)
- Zod schema validation for all inputs
- SHA256 hash dedup: compute hash(run details), skip if exists in DB
- Transactional insert: single database operation for run + run_members
- Realm slug normalization (e.g., "Tichondrius" → "tichondrius")

**WoW Constants Package**:
- Exported all 13 WoW classes with specs and roles
- Classes: Death Knight, Demon Hunter, Druid, Evoker, Hunter, Mage, Monk, Paladin, Priest, Rogue, Shaman, Warlock, Warrior
- Each class has specs (Frost/Unholy, etc.) with corresponding roles (DPS/Tank/Healer)

**17 Unit Tests** for scoring service covering all bonus scenarios

### Sprint A — Finish API (JWT + Webhooks)

**JWT Auth Flow**:
1. `/link` generates 6-digit code, stored in Redis with 10-minute TTL
2. User enters code in Electron app
3. Exchange endpoint: code + JWT claim data → signed JWT (HS256, API_JWT_SECRET)
4. JWT payload: `{ user_id, iat, exp }`

**Dual-Auth Pattern on POST /api/v1/runs**:
```
if (Authorization header has Bearer token) {
  if (token starts with 6-digit pattern) → internal auth (bot)
  else → JWT verification, ownership check (at least one run member in token user's characters)
}
```

**Discord Webhook Client**:
```
POST to webhook URL with embed:
{
  "title": "Run Completed: Violet Hold",
  "description": "Level 12 in 28:45 (3 deaths)",
  "fields": [
    { "name": "Members", "value": "Tanavast (Shaman, DPS)" },
    { "name": "Score", "value": "127 points" }
  ],
  "color": 16776960 (yellow)
}
```
- Fire-and-forget via HTTP POST, no webhook response handling needed
- Errors logged but don't fail run submission

**Auto-Create Unclaimed Characters**:
- If party member GUID not found in `characters` table, auto-create with `user_id = null` (migration: made user_id nullable)
- Useful for tracking runs with pugged players who haven't registered
- Can be claimed later when player links their Discord account

### Sprint 2 — WoW Addon

**Addon Manifest** (`MKeyTracker.toc`):
```
## Interface: 120001
## Title: MKeyTracker
## Version: 0.1.0
## SavedVariables: MKeyTrackerDB
```

**Event Capture**:
```lua
-- WoW Midnight renamed function from GetCompletionInfo to GetChallengeCompletionInfo
-- Returns table with: id, level, affixes, time, deaths, members, completed
-- info.members excludes player, must prepend self via GetPlayerInfoByGUID(UnitGUID("player"))

local info = C_ChallengeMode.GetChallengeCompletionInfo()
if info then
  members[1] = { name = UnitName("player"), class = select(2, UnitClass("player")), role = GetSpecializationInfo(...) }
  for i, member in ipairs(info.members) do
    members[i+1] = buildMemberFromInfo(member)
  end
end
```

**Robust Member Building**:
- Primary: `GetPlayerInfoByGUID(member.guid)` for in-game data
- Fallback: Use `member.name`, `member.class` from info.members
- Extract role from class + spec via wow-constants

**Client-Side Dedup**:
```lua
local hash = SHA256(dungeon_id .. level .. time .. table.concat(member_names))
if MKeyTrackerDB.posted_hashes[hash] then return end
```

**Slash Commands**:
- `/mkt dump` — display last run details
- `/mkt dump N` — display run N from history
- `/mkt clear` — clear saved runs
- `/mkt status` — show paired API status + last sync time
- `/mkt test` — inject fake run for testing
- `/mkt hide` — hide sync toast
- `/mkt resetpos` — reset toast position to center screen
- `/mkt debug on/off` — enable verbose logging to addon chat

**Sync Toast UI**:
- Draggable, movable frame with dismiss button
- "Sync & Reload" button calls `ReloadUI()` directly (not via C_Timer.After)
- Position saved in SavedVariables, persists between sessions
- Dismissible: can be hidden with `/mkt hide`

**Real Dungeon Data**:
- 8 Midnight S1 dungeons seeded: Nerub-ar Crypts, Mists of Tirna Scithe, The Stonevault, Shadowmoon Burial Grounds, Siege of Boralus, Ara-Kara Sewers, City of Threads, Dawnbreaker

### Sprint 3 — Companion CLI Engine

**Lua SavedVariables Parser**:
- Uses `luaparse` npm package for parsing WoW addon Lua files
- Critical gotcha: `encodingMode: "pseudo-latin1"` required or `StringLiteral.value` becomes null
- Parser extracts table structure from `MKeyTrackerDB = { runs = [...], posted_hashes = {...} }`

**File Watcher**:
- `chokidar` monitors WoW SavedVariables folder
- `awaitWriteFinish: { stabilityThreshold: 2000 }` debounce to wait for file write completion
- Watch path: `%APPDATA%/World of Warcraft/_retail_/WTF/Account/MESTOPGOBOOM/SavedVariables/MKeyTracker.lua`

**Queue Manager**:
1. Parse: Extract runs from SavedVariables file
2. Dedup: Check client-side hash against posted_hashes set
3. POST: Send to `POST /api/v1/runs` with JWT auth
4. Mark: Update SavedVariables to prevent re-posting

**Config Persistence**:
```json
{
  "wowAccountFolder": "C:\\Program Files\\World of Warcraft\\_retail_",
  "apiUrl": "https://api.mythicplustracker.com",
  "jwtToken": "eyJhbGc...",
  "discordUserId": "442112700592422913"
}
```
- Stored at `%APPDATA%/mplus-companion/config.json`
- Auto-created on first run
- Updated by Electron wizard

**CLI Subcommands**:
- `companion pair <discordUserId>` — initiates pairing flow
- `companion parse <filePath>` — one-time parse of SavedVariables
- `companion watch` — continuous watch + queue manager
- `companion config set <key> <value>` — update config
- `companion config get <key>` — read config

**6 Unit Tests**: Parser tests covering all edge cases (all passing)

### Sprint 4 — Companion Electron Shell + Onboarding + Deployment

**Electron 41 App**:
- IPC: main → renderer for config updates, watch status, run counts
- Preload bridge exposes safe APIs to renderer

**First-Run Wizard** (5 pages):
1. **Welcome**: Brand intro, feature overview, "Continue" button
2. **WoW Location**: Auto-detect via Windows Registry lookup of `HKEY_CURRENT_USER\Software\Blizzard Entertainment\World of Warcraft`; manual picker fallback
3. **Account Picker**: List all accounts in `_retail_/WTF/Account/`, select one
4. **Discord Pair**: Display 6-digit code, user enters in Discord bot `/link` command, confirm pairing
5. **Done**: Summary, launch companion watcher, move to tray

**Dashboard**:
- Stat grid: pairing status, watcher running, runs synced (total count), last sync timestamp
- SavedVariables card: shows detected file, file size, run count, last modified
- Update banner: "New version available" with download + restart buttons
- Re-sync button: force parser queue flush

**System Tray**:
- Icon with right-click context menu
- "Open", "Sync Runs", "Settings", "Exit"
- Close-to-tray behavior with first-time notification
- Single-instance check: second launch focuses existing window

**Auto-Updater**:
- `electron-updater` (must be in `dependencies` not `devDependencies` or gets pruned)
- Checks GitHub Releases for new version on app start
- Triggers auto-download + install on user action
- Restarts app after update

**NSIS Windows Installer**:
- Generated by `electron-builder`
- Creates Start menu shortcuts, uninstaller, file associations
- ~80 MB package size (Chromium + Node + app code)

**Icon Generation Pipeline**:
```
source.svg → sharp library → multi-res PNGs (16, 24, 32, 48, 64, 128, 256, 512)
         → png-to-ico → app.ico (bundled in EXE)
```

**Anonymous Telemetry Client**:
- Optional tracking: app version, OS, watcher status, run submissions
- `POST /api/v1/telemetry` with JSON payload
- Prisma model: `telemetry_events(id, user_id, event_type, payload, created_at)`
- User can opt-out in settings

**Config Migration**:
- Automatic upgrade: if apiUrl contains `localhost:3001`, rewrite to `https://api.mythicplustracker.com`
- Useful for users who tested on local dev environment

**Bot Commands**:
- `/register` — updated with new download link to GitHub Releases
- `/setup` — new command with quick-start guide + download link

### Production Deployment

**Docker Infrastructure**:

*API Dockerfile*:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
EXPOSE 3020
CMD ["tsx", "apps/api/src/index.ts"]
```

*Bot Dockerfile*:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
EXPOSE 3021
CMD ["tsx", "apps/bot/src/index.ts"]
```

Both include `docker-entrypoint.sh`:
```bash
#!/bin/bash
cd /app
npx prisma migrate deploy  # Run any pending migrations
npx prisma db seed        # Seed seasons + dungeons if needed
exec npm start
```

**docker-compose.prod.yml**:
```yaml
version: '3.8'
networks:
  tech-stack-net:
    external: true
services:
  postgres:
    image: postgres:16
    ports: ["5434:5432"]
    environment:
      POSTGRES_DB: mkeytracker
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7
    ports: ["6379:6379"]
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports: ["3020:3020"]
    environment:
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@postgres:5432/mkeytracker
      REDIS_URL: redis://redis:6379
      API_INTERNAL_SECRET: ${API_INTERNAL_SECRET}
      JWT_SECRET: ${JWT_SECRET}
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN}
    networks: [tech-stack-net]
  bot:
    build:
      context: .
      dockerfile: Dockerfile.bot
    ports: ["3021:3021"]
    environment:
      [same env vars as api]
    networks: [tech-stack-net]
    depends_on: [postgres, redis, api]
volumes:
  pgdata:
```

**Unraid Deployment** (192.168.1.4):
- PostgreSQL 16 on port 5434
- Redis 7 on port 6379
- API on port 3020
- Bot on port 3021
- Volumes persist across restarts

**Nginx Proxy Manager** (192.168.1.2):
- Reverse proxy: `api.mythicplustracker.com:443` → `192.168.1.4:3020`
- SSL certificate: Let's Encrypt via DNS-01 Cloudflare challenge
- Cloudflare DNS: A record for `api.mythicplustracker.com` → 192.168.1.2 (proxied, orange cloud)

**Domain Setup**:
- `mythicplustracker.com` registered, Cloudflare nameservers
- DNS records: api, www subdomains
- SSL auto-renewal via ACME

**Download Endpoint**:
- `GET /download` → dynamic 302 redirect to latest GitHub release `.exe`
- Backend: queries GitHub API, caches in Redis (5-minute TTL)
- Returns `Location: https://github.com/hitf5now/mkeytracker/releases/download/v0.1.3/mplus-companion-0.1.3.exe`

**GET /download/info**:
```json
{
  "latest_version": "0.1.3",
  "download_url": "https://github.com/hitf5now/mkeytracker/releases/download/v0.1.3/mplus-companion-0.1.3.exe",
  "release_notes": "...",
  "size_bytes": 85000000
}
```
- Useful for future web frontend version checking

### Sprint 5 — Leaderboards + Profiles

**Player Profile Endpoint**:
- `GET /api/v1/characters/:region/:realm/:name`
- Returns player stats for current season:
```json
{
  "character": {
    "name": "Tanavast",
    "realm": "Trollbane",
    "region": "us",
    "class": "Shaman",
    "spec": "Elemental",
    "rio_score": 1794
  },
  "season_stats": {
    "total_runs": 42,
    "highest_key": 12,
    "total_points": 5340,
    "best_per_dungeon": [
      { "dungeon": "Nerub-ar Crypts", "level": 12, "time": "28:45", "date": "2026-04-10" }
    ],
    "recent_runs": [...]
  }
}
```

**Leaderboard Endpoints**:
- `GET /api/v1/leaderboards/season-points` — top 100 by total points
- `GET /api/v1/leaderboards/highest-key` — top 100 by highest key completed
- `GET /api/v1/leaderboards/most-timed` — top 100 by run count
- `GET /api/v1/leaderboards/fastest-clear-nerub-ar-crypts` — top 100 for dungeon, sorted by time
- (8 per-dungeon leaderboards, one for each S1 dungeon)

**Stats Service**:
- Uses Prisma raw SQL queries for aggregation (efficient at scale)
- Materializes results with optional Redis caching layer (not yet implemented)
- SQL queries:
  - Top scorers: `SELECT user_id, SUM(score) as total_points FROM runs GROUP BY user_id ORDER BY total_points DESC LIMIT 100`
  - Per-dungeon fastest: `SELECT user_id, MIN(time_ms) as best_time FROM runs WHERE dungeon_id = $1 GROUP BY user_id ORDER BY best_time ASC LIMIT 100`

**Bot /profile Command**:
- Slash command: `/profile <character> [realm] [region]`
- Response embed with class-colored theme (e.g., Shaman = light blue)
- Displays:
  - Character name, realm, RIO score
  - Season stats: total runs, highest key, total points
  - Best per dungeon: table of all 8 dungeons with personal records
  - Recent 5 runs with timestamps

**Bot /leaderboard Command**:
- Slash command with category dropdown
- 11 options: season-points, highest-key, most-timed, + 8 per-dungeon
- Response: top-10 leaderboard embed, formatted as ranked list
```
1. Tanavast — 12 (28:45)
2. Anotherplayer — 12 (29:12)
...
```

## Files Modified/Created

### Core Infrastructure
- `package.json` — monorepo workspaces definition
- `docker-compose.yml` — local dev PostgreSQL + Redis
- `docker-compose.prod.yml` — production deployment
- `Dockerfile.api`, `Dockerfile.bot` — container images
- `prisma/schema.prisma` — database schema
- `.github/workflows/companion-release.yml` — CI/CD for releases

### API (Fastify)
- `apps/api/src/index.ts` — server, route registration
- `apps/api/src/routes/register.ts` — `POST /api/v1/register`
- `apps/api/src/routes/runs.ts` — `POST /api/v1/runs` with dual-auth
- `apps/api/src/routes/link.ts` — JWT pairing flow
- `apps/api/src/routes/leaderboards.ts` — `GET /api/v1/leaderboards/*`
- `apps/api/src/routes/characters.ts` — `GET /api/v1/characters/:region/:realm/:name`
- `apps/api/src/routes/download.ts` — GitHub release redirect + info endpoint
- `apps/api/src/services/scoring.ts` — run scoring logic, 17 unit tests
- `apps/api/src/services/stats.ts` — leaderboard aggregation
- `apps/api/src/clients/raiderio.ts` — HTTP client for character lookups
- `apps/api/src/clients/discord-webhook.ts` — run announcement embeds
- `apps/api/src/middleware/auth.ts` — JWT verification, internal auth

### Discord Bot
- `apps/bot/src/index.ts` — bot startup, event handlers
- `apps/bot/src/commands/register.ts` — `/register` command
- `apps/bot/src/commands/link.ts` — `/link` pairing command
- `apps/bot/src/commands/ping.ts` — `/ping` health check
- `apps/bot/src/commands/profile.ts` — `/profile` player stats
- `apps/bot/src/commands/leaderboard.ts` — `/leaderboard` with dropdown
- `apps/bot/src/commands/setup.ts` — `/setup` with download link

### WoW Addon
- `addon/MKeyTracker.toc` — manifest
- `addon/MKeyTracker.lua` — main frame, event hooks
- `addon/MKeyTrackerCapture.lua` — `CHALLENGE_MODE_COMPLETED` event
- `addon/MKeyTrackerCommands.lua` — slash command handlers
- `addon/MKeyTrackerUI.lua` — sync toast frame, draggable UI
- `addon/MKeyTrackerUtils.lua` — utilities, SHA256, member building

### Companion (Electron + CLI)
- `apps/companion/src/main.ts` — Electron main process
- `apps/companion/src/preload.ts` — IPC bridge
- `apps/companion/src/renderer/App.tsx` — React root
- `apps/companion/src/renderer/pages/Wizard.tsx` — 5-page onboarding
- `apps/companion/src/renderer/pages/Dashboard.tsx` — main dashboard
- `apps/companion/src/renderer/pages/Settings.tsx` — app settings
- `apps/companion/src/engine/parser.ts` — Lua SavedVariables parser, luaparse integration
- `apps/companion/src/engine/queue-manager.ts` — parse → dedup → POST → mark
- `apps/companion/src/engine/watcher.ts` — chokidar file watcher
- `apps/companion/src/cli/index.ts` — CLI entry point
- `apps/companion/src/cli/commands/pair.ts` — pairing flow
- `apps/companion/src/cli/commands/watch.ts` — run watcher loop
- `apps/companion/src/cli/commands/config.ts` — config management
- `apps/companion/package.json` — electron-builder config, icon generation

### Shared Types
- `packages/types/index.ts` — TypeScript interfaces for all domains
- `packages/wow-constants/index.ts` — WoW classes, specs, roles

## Critical Bugs Found & Fixed

1. **WoW Midnight function rename**: `C_ChallengeMode.GetCompletionInfo()` → `GetChallengeCompletionInfo()`. Old name returns flat values; new name returns table with `{ id, level, affixes, time, deaths, members, completed }`. Members array excludes player, requiring manual prepend via `GetPlayerInfoByGUID(UnitGUID("player"))`.

2. **Party member exclusion**: `info.members` from `GetChallengeCompletionInfo()` does not include the player running the addon. Must insert player at index 0 using `GetPlayerInfoByGUID(UnitGUID("player"))`.

3. **RaiderIO 400 vs 404**: RaiderIO API returns HTTP 400 (not 404) when character not found. Updated client error handling to check `response.status === 400` as "not found".

4. **Protected action in callback**: `ReloadUI()` cannot be called inside `C_Timer.After()` callback due to protected action restrictions. Must call directly from slash command handler or event callback without timer.

5. **luaparse StringLiteral null**: `luaparse` requires `{ encodingMode: "pseudo-latin1" }` option or all `StringLiteral.value` properties become null, breaking parser. Added to parser initialization.

6. **electron-updater pruning**: Mistakenly placed `electron-updater` in `devDependencies`. `electron-builder` prunes dev dependencies before bundling, so updater code fails at runtime. Moved to `dependencies`.

7. **Versioned artifact names break downloads**: `artifactName: "mplus-companion-${version}.exe"` in electron-builder config broke direct GitHub release downloads because URLs contain version twice. Changed to unversioned `artifactName: "mplus-companion.exe"` with version-specific tag in `publish[].releaseType`.

## Production Secrets (Stored in Memory / Environment)

- **DB_PASSWORD**: PostgreSQL admin password at `/mnt/user/appdata/mplus-platform/source/.env`
- **JWT_SECRET**: HS256 key for signing JWTs
- **API_INTERNAL_SECRET**: Pre-shared bearer token (bot → API auth)
- **DISCORD_BOT_TOKEN**: Discord application token for bot authentication
- **Cloudflare API Token**: DNS-01 ACME challenge authentication for Let's Encrypt renewal
- **Discord Guild ID**: Target guild for bot slash commands + webhook results channel
- **Discord Webhook URLs**: Incoming webhook for #results channel

Note: All secrets stored in `.env` file on Unraid, not in git repo (.gitignore)

## User Profile & Account Details

- **GitHub**: hitf5now
- **Discord User ID**: 442112700592422913
- **WoW Main Character**: Tanavast-Trollbane (US realm), Shaman, Elemental spec
  - RaiderIO Score: 1794
  - Current Mythic+ key: High 12s
- **WoW Account Folder**: MESTOPGOBOOM
- **System**: Windows 11 Home, Unraid server at 192.168.1.4
- **Domain Manager**: Cloudflare (mythicplustracker.com)

## GitHub Releases Published

- **v0.1.0**: Initial companion app release with onboarding + watcher
- **v0.1.1**: Bug fixes for addon integration
- **v0.1.2**: Leaderboard API + bot profile/leaderboard commands
- **v0.1.3**: Version display in dashboard + system tray menu

All releases trigger via `companion-release.yml` GitHub Action on tag push (v*.*.* pattern). Windows NSIS installer auto-uploaded to releases.

## Architecture Overview

```
┌─────────────────┐
│  WoW Addon      │ → Captures CHALLENGE_MODE_COMPLETED
├─────────────────┤   SavedVariables: MKeyTrackerDB
│ SavedVariables  │
└────────┬────────┘
         │ File written to disk
         │
┌────────▼──────────────────┐
│  Electron Companion App   │ → Watches SavedVariables folder
├───────────────────────────┤   Parses with luaparse
│ Parser + Queue Manager    │   Dedup + POST to API
└────────┬──────────────────┘   Shows UI feedback
         │ JWT auth
         │
    ┌────▼─────┐
    │ Fastify  │ ◄─── Discord Bot (internal auth)
    │ API      │      (Commands: /register, /link, /profile, /leaderboard)
    │ 3020     │
    └────┬─────┘
         │
    ┌────▼──────────────────┐
    │ PostgreSQL + Redis    │
    │ (Unraid 192.168.1.4)  │
    └───────────────────────┘

Nginx Proxy Manager (192.168.1.2):
  api.mythicplustracker.com:443 → Unraid:3020 (SSL via Let's Encrypt DNS-01)
```

## Leaderboard Implementation Notes

- Current: On-demand SQL aggregation per request (efficient for small datasets)
- Future optimization: Redis sorted sets + materialized views for caching at scale
- Considered but deferred: Personal record bonuses computed at leaderboard time (currently in scoring only)

## Next Steps (Proposed)

### Sprint 6 — Events System
- `/event create <name> <date>` — Create Mythic+ event registration
- Role-based signup with `/event signup <role>` — DPS/Tank/Healer picker
- Team matchmaking: auto-form balanced teams from signups
- Event leaderboard: track event-specific scores
- Discord announcement channel for event creation + registration status

### Sprint 7 — Web Frontend
- Next.js app at `app.mythicplustracker.com`
- Pages: profile lookup, leaderboards, character search
- Real-time stats updates (WebSocket or polling)
- Season timeline and dungeon rotation tracker
- Affixes display for current week

### Polish Tasks
- CI test workflow: currently GitHub Actions doesn't run unit tests on push (fix runner or deps)
- `/profile` auto-lookup by Discord ID: eliminate need to type character name
- Create separate dev Discord bot application: prevent confusion between prod/dev instances
- Fix any failing unit tests before v0.2.0

## Context for Future Sessions

**Key Architectural Patterns**:
- Dual-auth pattern (internal bearer + JWT) enables both bot automation and user-driven companion app
- Client-side dedup with SHA256 prevents duplicate submissions across addon → companion → API pipeline
- Fire-and-forget Discord webhooks for async notifications (critical: don't await webhook response)
- RaiderIO as single source of truth for character validation; caching in PostgreSQL for quick lookups

**Testing Checklist for Next Session**:
- Run all unit tests: `npm test` (should see 17 scoring tests, 6 parser tests, others)
- Test full flow: addon capture → SavedVariables write → companion parse → API submit → Discord announcement + leaderboard update
- Verify production API health: `curl https://api.mythicplustracker.com/health`
- Check latest release download: `curl -L https://mythicplustracker.com/download -I` (should 302 redirect)

**Known Workarounds**:
- WoW Midnight addon: always include `GetPlayerInfoByGUID` fallback for member data (unreliable from info.members alone)
- Companion parser: use `encodingMode: "pseudo-latin1"` in luaparse options (required for non-ASCII realm names)
- electron-updater: keep in `dependencies`, never move to `devDependencies`
- Protected actions in WoW: never schedule `ReloadUI()` via timer, call directly from slash command or event

**Deployment Notes**:
- Docker images build monorepo with workspaces via single Dockerfile context
- Prisma migrations run automatically on container start (idempotent via `prisma migrate deploy`)
- Redis is required for JWT pairing flow (6-digit code storage + TTL)
- Nginx Proxy Manager reverse proxy is critical for HTTPS; API doesn't handle SSL (relies on proxy)
- Cloudflare DNS-01 challenges require API token stored securely; auto-renews Let's Encrypt certs
