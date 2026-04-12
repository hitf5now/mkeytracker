# M+ Challenge Platform — Development Context

> **Purpose:** Drop this file into a Claude Code session (or any dev session) to establish full project context. Covers architecture decisions, technical constraints, feature scope, and where to start.

---

## What We're Building

A cross-guild Mythic+ competitive platform for WoW communities. The core problem: no existing tool combines automated cross-guild matchmaking, instant run tracking (bypassing RaiderIO's 1-2 hour lag), multi-category leaderboards that reward more than just raw skill, and in-game display of standings.

The platform consists of four applications that work together:

| App | Tech | Role |
|-----|------|------|
| **WoW Addon** (`MKeyTracker`) | Lua 5.1 | Captures runs instantly on completion; reads inbound leaderboard data |
| **Companion App** | Electron + Node.js | Watches SavedVariables file; POSTs runs to backend; writes inbound data |
| **Backend API** | Fastify + PostgreSQL + Redis | Run storage, scoring, leaderboards, matchmaking, Discord webhooks |
| **Discord Bot** | discord.js 14 | Registration, event creation, signup embeds, team assignment, results |
| **Web Frontend** | Next.js 14 App Router | Public leaderboards, player profiles, event pages, live SSE updates |

---

## Critical Technical Constraints (Read First)

### WoW Addon Sandbox
- **NO network access** — addons cannot make HTTP requests of any kind
- **NO arbitrary file writes** — the only write mechanism is `SavedVariables` (flushed on `/reload`, logout, or crash)
- **Data channel:** Addon writes to `SavedVariables`; companion app reads with `fs.watch()` and POSTs to backend
- **Inbound channel:** Companion app writes server data back into the `SavedVariables` .lua file; addon reads on next `/reload`
- This is the TSM/Warcraft Logs uploader pattern — battle-tested

### Cross-Instance Limitation
- `C_ChatInfo.SendAddonMessage()` only reaches players in the **same instance**
- Groups in different instances cannot communicate via addon messages
- Competition overlay shows "last known state" loaded at run start — not true live rival tracking

### Cross-Realm Group Formation
- Players from different realms need BattleTag friends or Group Finder invite
- Solution: `/btag` Discord command stores BattleTags (opt-in); bot DMs teammates' BattleTags before events

### Run Submission Flow
1. `CHALLENGE_MODE_COMPLETED` fires → `C_ChallengeMode.GetCompletionInfo()` captures full result
2. Addon writes to `SavedVariables.pendingRuns[]`
3. Player does `/reload` (natural post-dungeon behavior)
4. WoW flushes SavedVariables to disk
5. `fs.watch()` fires in companion app (~2 sec)
6. Companion POSTs to `POST /api/v1/runs` with JWT
7. Backend stores, scores, webhooks Discord (~8-10 sec total)
8. RaiderIO cross-verification runs as background job 4 hours later

---

## Repository Structure

```
mplus-platform/
├── apps/
│   ├── api/                  # Fastify + Prisma
│   │   ├── src/
│   │   │   ├── routes/       # /auth /runs /events /leaderboards /users
│   │   │   ├── services/     # scoring, matchmaking, badges
│   │   │   ├── jobs/         # BullMQ: verify runs, refresh leaderboards
│   │   │   └── lib/          # raiderio.ts, discord-webhook.ts, redis.ts
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   ├── web/                  # Next.js 14 App Router
│   │   └── app/
│   │       ├── page.tsx
│   │       ├── leaderboards/
│   │       ├── events/[id]/
│   │       ├── players/[id]/
│   │       └── teams/[id]/
│   ├── bot/                  # discord.js
│   │   └── src/
│   │       ├── commands/     # /register /event /signup /team /leaderboard /btag /mentor
│   │       ├── events/
│   │       └── lib/          # embeds.ts, matchmaking.ts
│   └── companion/            # Electron
│       └── src/
│           ├── main/         # tray, file watcher
│           ├── renderer/     # setup UI
│           └── lib/          # lua-parser.ts, api-client.ts, inbound-writer.ts
├── packages/
│   ├── types/                # Shared TypeScript interfaces
│   ├── scoring/              # Points formula (shared by API + web)
│   └── wow-constants/        # Dungeon IDs, class/spec names, affix IDs
├── addon/
│   ├── MKeyTracker.toc
│   ├── MKeyTracker.lua       # Run capture, event detection
│   ├── MKeyTrackerUI.lua     # Leaderboard frame, HUD, popups
│   └── MKeyTrackerData.lua   # SavedVariables schema docs
├── docker-compose.yml        # Local dev: postgres + redis
├── docker-compose.prod.yml   # Unraid production stack
└── .github/workflows/
    ├── test.yml
    └── deploy.yml
```

---

## Tech Stack

```
Runtime:        Node.js 20 LTS
Language:       TypeScript 5.x strict mode (all apps)
API:            Fastify 4.x
Database:       PostgreSQL 16 (materialized views for season LBs)
Cache/Queue:    Redis 7 (sorted sets for weekly LBs; BullMQ for background jobs)
ORM:            Prisma 5.x
Frontend:       Next.js 14 App Router + shadcn/ui + Tailwind CSS
Real-time:      Server-Sent Events (SSE) for leaderboard live push
Auth:           NextAuth.js v5 + Discord OAuth
Discord:        discord.js 14.x
Companion:      Electron (latest)
WoW Addon:      Lua 5.1, Interface: 120001 (WoW Midnight)
Testing:        Vitest (unit/integration) + Playwright (E2E)
CI/CD:          GitHub Actions → deploy to Unraid on merge to main
Hosting:        Unraid (API + DB + Redis); Vercel (web frontend)
```

---

## Database Schema (Core Tables)

```sql
-- Reference data
seasons         (id, name, starts_at, ends_at, patch)
dungeons        (id, challenge_mode_id, name, par_time_sec, season)

-- Identity
users           (id, discord_id, battle_tag, timezone, is_mentor, mentor_points)
characters      (id, user_id, name, realm, region, class, spec, role, rio_score)

-- Teams
teams           (id, name, created_by_user_id)
team_members    (team_id, user_id, character_id)

-- Events
events          (id, name, type, dungeon_id, min_key_level, max_key_level,
                 scoring_mode, signup_closes_at, starts_at, ends_at, status,
                 score_cap_max, handicap_enabled, ironman_mode, rookie_league)
event_signups   (id, event_id, user_id, character_id, role_preference,
                 preferred_teammate_ids[], team_id, signed_up_at)
event_teams     (id, event_id, team_id, assigned_at, status, bingo_card_json)

-- Runs
runs            (id, dungeon_id, keystone_level, completion_ms, par_ms,
                 on_time, upgrades, deaths, time_lost_sec, server_time,
                 recorded_at, source, verified, event_id, team_id)
run_members     (id, run_id, user_id, character_id, class, spec, role)

-- Scoring & Leaderboards
points_log      (id, user_id, team_id, run_id, points, reason, earned_at)
leaderboard_entries (id, category, scope, scope_id, user_id, team_id,
                     metric_value, rank, updated_at)

-- Mentorship
mentor_sessions (id, mentor_user_id, mentee_user_id, run_id,
                 mentor_points_earned, mentee_score_before, mentee_score_after)

-- Badges
badge_definitions (id, slug, name, description, tier, secret, phase)
player_badges   (id, user_id, badge_slug, earned_at, context_json)
```

---

## Points Scoring Formula

```
Base = keystoneLevel × 100

Time Modifier:
  Depleted:   × 0.5
  Timed:      × 1.0
  Timed +1:   × 1.2
  Timed +2:   × 1.35
  Timed +3:   × 1.5

Bonuses:
  0 deaths:                    +150 pts
  Personal dungeon record:     +200 pts
  Personal overall record:     +500 pts
  Event participation:         +100 pts

Example: Stonevault +15, timed +2, 0 deaths, personal dungeon record
  = (15 × 100) × 1.35 + 150 + 200 = 2,375 pts

Team Score = sum of all 5 members' individual scores per run
Season Team Score = sum of team's best run per dungeon
```

---

## Event Types

### Speed & Racing
| Type | Description |
|------|-------------|
| Fastest Clear Race | All teams, same dungeon, defined window. Fastest timed clear wins. |
| Speed Record Night | Fixed dungeon + level, unlimited attempts. Best single time wins. |
| Progressive Key | All start same level. Each timed clear auto-upgrades key. Last team standing wins. |
| Relay Race | Each player owns one dungeon. Team score = combined times. |
| Bracket Tournament | Single/double elimination. Head-to-head same dungeon. |
| Blind Draw Night | Dungeon + affixes revealed 30 min before window. No prep. |
| Speed Sprint | 30-minute window, single attempt per team. |
| Weekly Challenge | Auto-generated weekly with featured dungeon + scoring twist. |

### Handicap & Parity
| Type | Description |
|------|-------------|
| Handicap Race | Lower-score teams get time bonus based on avg RIO gap vs top team. |
| Random Draft Night | Bot assembles teams from signup pool — role-balanced, otherwise random. |
| Rookie League | Parallel events gated at a max RIO score cap. New players compete vs peers. |
| Prestige Mode | Players above threshold must play off-spec or non-main class. |
| Skill Bracket Nights | Bronze/Silver/Gold brackets by avg team RIO. Each bracket has own champion. |

### Social & Coaching
| Type | Description |
|------|-------------|
| Mentor Cup | One player above 3,000 paired with one below 2,000. Score weighted toward mentee improvement. |
| Cross-Guild Showdown | Two communities field teams head-to-head. |
| Academy Night | High-score players guide (non-scoring) while new players run. |
| Duo Cup | Pairs from most frequent duo partners; 3 remaining spots random. |

### Novelty
| Type | Description |
|------|-------------|
| Bingo Night | 5×5 dungeon/level card. Teams compete for line, diagonal, or blackout. |
| Ironman | Deaths void the run's scoring (run still completes, earns 0 event points). |
| The Gauntlet | All 8 dungeons timed in one session. Fastest combined time wins. |
| Affix Specialty | Tied to weekly affixes. Bonus multiplier specific to that week. |
| Spec Shuffle | Each member must play a spec not used in their last 5 runs. |

---

## Individual Leaderboard Categories

### Performance
- Highest Key Completed (season)
- Fastest Clear per dungeon — 8 separate boards (season)
- Weekly Score Gain (weekly)
- Most Timed Runs (weekly + season)
- Best Time Under Par — avg seconds under par across all timed runs, min 10 (season)
- Well-Rounded Runner — aggregate across all 8 dungeons (season)

### Role-Specific
- Top Tank / Top Healer / Top DPS — highest key timed per role (season)
- Class Champions — one per WoW class, 13 boards (season)
- Dungeon Specialist — best combined time+level per dungeon, 8 boards (season)

### Growth & Improvement
- Rising Star — biggest RIO gain/week, weighted by starting score (weekly)
- Most Improved — biggest total gain since joining platform (all-time)
- Rookie Standout — top performer in Rookie League events
- Consistency Score — lowest variance in completion times, min 10 runs (season)

### Social & Community
- Most Unique Teammates (season)
- Community Builder — ran with players from most different guilds (season)
- The Welcomer — first to run with each newly registered player (season)
- Best Mentor — mentees' greatest avg RIO improvement (season)
- Cross-Realm Explorer — most unique realms in run history (season)

### Fun / Novelty
- Cleanest Runner — fewest deaths per 10 runs, min 10 (season)
- Clutch Factor — most runs timed with <60 seconds remaining (season)
- Speed Freak — total accumulated seconds under par (season)
- Night Owl — most runs 12am-5am local time (season)
- Monday Motivation — most runs in first 2 hours after Tuesday reset (weekly)

---

## Badge System

### Tiers
- **Starter** — Everyone gets these early (onboarding + first milestones)
- **Skilled** — Require consistent effort over multiple sessions
- **Prestige** — Rare, season-defining achievements
- **Social** — Earned through community participation and mentorship
- **Secret** — Hidden until earned; shown as "????" in badge grid

### Key Badges

**Starter:** First Key, First Timed Clear, Ten Keys Deep, Event Debutante, Explorer (all 8 dungeons), Registered

**Skilled:** Perfectionist (+15 timed, 0 deaths), Speed Demon (5+ min remaining), Clutch! (<30 sec remaining), Podium Finisher, Grinder (50 runs), Iron Wall (tank, 20 keys <3 deaths total), The Life Line (healer, 20 keys 0 teammate deaths), Spec Loyalist (50 runs same spec), Jack of All Trades (tank+heal+DPS same season), Well-Rounded, Century Runner, Event Champion, Consistent Competitor, Ride or Die (50 runs with same player), Guild Ambassador

**Prestige:** Flawless (+20 timed, 0 deaths), Gauntlet Complete (all 8 in one day), Hat Trick (3 event wins), Ironman Legend (+20 0 deaths in event), Perfect Competitor, Class Champion, Dungeon Master (season fastest record holder), **Season Legend** (top 3 overall — permanent hall of fame)

**Social:** First Steps (received from first experienced player to run with you — shows mentor's name), The Welcomer, The Guide (ran with 5 players <1,500 RIO), Mentor, **The Legacy** (mentee reached Keystone Hero — both players receive it, connection shown permanently), Social Butterfly, Community Pillar, Duo Partner, Three's Company, Cross-Realm Explorer

**Secret (hidden until earned):** Night Owl (run after 3am local), Monday Hero (within 15 min of reset), Season Closer, Anniversary Runner, Dungeon Historian (returning dungeon), The Comeback (depleted key within 5% of par), Pure Luck (won Random Draft as lowest-score team), Same Score (tied another team's exact time)

---

## Mentorship Framework

```
Mentor eligibility:    RaiderIO score ≥ 2,500
Mentee eligibility:    RaiderIO score ≤ 1,800

Matching priority:     same realm > same class > timezone > availability
Opt-in:                /mentor register in Discord
Request:               /mentor request in Discord

Tracking:
  - Runs between matched pairs auto-flagged as "mentored sessions"
  - Mentor Points = f(mentee score improvement per session) — NOT just run count
  - Carrying earns fewer Mentor Points than measurable improvement

Profile display:
  - Mentee profile: "Mentored by: [name]"
  - Mentor profile: "Mentored: [name] (+847 score improvement)"
  - Both: permanent connection, visible to everyone
  - The Legacy badge: awarded to both when mentee reaches Keystone Hero

Rookie League:
  - Parallel event calendar, same event types
  - Score cap enforced per event (typically ≤ 2,200 RIO)
  - Veterans may observe via Discord thread (non-scoring)
  - Graduates earn "Graduated" badge and move to main track
  - Rookie League champions get equal public recognition to main track
```

---

## Discord Bot Commands

```
/register [character] [realm] [region]   Link Discord to WoW character via RaiderIO
/register [additional char]              Add secondary character
/btag [battletag]                        Store BattleTag (opt-in, shared with event teammates)
/event create                            Modal: name, type, dungeon, dates, settings
/event status [id]                       Signup counts, slot availability
/signup [event]                          Sign up with role preference + preferred teammates
/team create                             Create pre-made team, invite 4 Discord users
/leaderboard [category] [scope]          Top 10 for any category
/mentor register                         Opt in as mentor (requires ≥2,500 RIO)
/mentor request                          Request mentor matching (requires ≤1,800 RIO)
/readycheck                              Ping team in private thread before event
```

---

## Companion App — Inbound Data Schema

The companion app writes this structure to the SavedVariables `.lua` file every 2 minutes. Addon reads it on next `/reload`.

```typescript
interface InboundData {
  leaderboard: LeaderboardEntry[];      // Current standings for all categories
  myRankings: MyRankEntry[];            // Player's own position across all categories
  activeCompetition: {
    eventId: number;
    teamName: string;
    rivals: RivalTeam[];                // Their last known best for competition overlay
    eventWindowEnds: number;            // Unix timestamp
  } | null;
  messages: string[];                   // System messages to display in-game
  updatedAt: number;                    // Unix timestamp of last server sync
}
```

---

## WoW Addon — Key Events & APIs

```lua
-- Run start
CHALLENGE_MODE_START
C_ChallengeMode.GetActiveChallengeMapID()
C_ChallengeMode.GetActiveKeystoneInfo()  -- level, affixes

-- Run completion
CHALLENGE_MODE_COMPLETED
C_ChallengeMode.GetCompletionInfo()
  -- Returns: mapID, level, time, onTime, keystoneUpgradeLevels, practiceRun, oldOverallDungeonScore
C_ChallengeMode.GetDeathCount()          -- deaths, timeLostSeconds

-- Party tracking
PARTY_MEMBERS_CHANGED
GetNumGroupMembers()
GetRaidRosterInfo(index)                 -- name, rank, subgroup, level, class, ...

-- Addon messaging (guild-scoped only — cannot reach cross-realm)
C_ChatInfo.SendAddonMessage("MKEYTRACKER", payload, "GUILD")
C_ChatInfo.RegisterAddonMessagePrefix("MKEYTRACKER")

-- SavedVariables structure
MKeyTrackerDB = {
  pendingRuns = {},    -- outbound queue to companion app
  inbound = {},        -- written by companion app, consumed by addon
  settings = {},
  playerData = {},
}
```

---

## Deployment — Unraid Docker Stack

```yaml
# docker-compose.prod.yml (abbreviated)
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - /mnt/user/appdata/mplus-platform/postgres:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - /mnt/user/appdata/mplus-platform/redis:/data

  api:
    image: ghcr.io/yourname/mplus-api:latest
    ports: ["3001:3001"]
    environment:
      DATABASE_URL: postgresql://mplus:${DB_PASSWORD}@postgres:5432/mplus_platform
      REDIS_URL: redis://redis:6379
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN}
      JWT_SECRET: ${JWT_SECRET}

  bot:
    image: ghcr.io/yourname/mplus-bot:latest
    environment:
      API_BASE_URL: http://api:3001
      API_INTERNAL_SECRET: ${API_INTERNAL_SECRET}

# Web frontend → Vercel (free tier)
# Reverse proxy: Nginx Proxy Manager on Unraid
#   api.yourdomain.com  → localhost:3001  (SSL via Let's Encrypt)
```

---

## Development Phases

| Phase | Scope | Duration | Deliverable |
|-------|-------|----------|-------------|
| **1** | Foundation — Run Capture & Registration | Weeks 1–4 | Instant run tracking, companion app, basic Discord bot |
| **2** | Events & Matchmaking | Weeks 5–7 | Cross-guild events, signup embeds, team formation |
| **3** | Web Interface & Full Leaderboards | Weeks 8–12 | Public website, live SSE updates, all LB categories |
| **4** | In-Game Experience | Weeks 13–16 | Addon HUD, competition overlay, achievement toasts |
| **5** | Mentorship System | Weeks 17–19 | Mentor matching, social badges, Discord roles |
| **6** | Advanced Analytics | Weeks 20–24 | WCL integration, replay system, mobile PWA |

---

## Phase 1 Sprint Tasks (Start Here)

### Sprint 1 — Infrastructure Setup
- [ ] Initialize monorepo: `npm workspaces`, TypeScript config, `packages/types`
- [ ] `docker-compose.yml`: PostgreSQL 16 + Redis 7
- [ ] Prisma schema: `users`, `characters`, `runs`, `run_members`, `dungeons`, `seasons`
- [ ] Run first migration; seed dungeon and season reference data
- [ ] GitHub Actions: lint + typecheck on every push
- [ ] Unraid: stand up postgres + redis containers with persistent volumes in `/mnt/user/appdata/mplus-platform/`

### Sprint 2 — WoW Addon Core
- [ ] `MKeyTracker.toc` with `## Interface: 120001` and `## SavedVariables: MKeyTrackerDB`
- [ ] Register `CHALLENGE_MODE_COMPLETED` and `CHALLENGE_MODE_START`
- [ ] Capture full run payload with `GetCompletionInfo()` + `GetDeathCount()`
- [ ] Write to `MKeyTrackerDB.pendingRuns[]` queue
- [ ] In-game chat confirmation message on capture
- [ ] Test against live runs; validate all fields

### Sprint 3 — Companion App
- [ ] Electron skeleton: main process, system tray, settings renderer
- [ ] First-run wizard: auto-detect WoW installation path (Windows + Mac)
- [ ] `fs.watch()` on SavedVariables file with 500ms debounce
- [ ] Lua SavedVariables parser → TypeScript objects
- [ ] Auth: `/auth/link` generates token; companion exchanges for JWT
- [ ] `POST /api/v1/runs` with retry queue for offline scenarios
- [ ] Mark submitted runs; prevent duplicates

### Sprint 4 — Backend API + Discord Bot
- [ ] Fastify routes: `POST /runs`, `/auth/link`, `GET /characters/:name/:realm`
- [ ] Run deduplication: hash of `dungeonId + level + serverTime + members[0].name`
- [ ] Discord bot: `/register` with RaiderIO character validation
- [ ] Discord webhook: run announcement embed in `#results` on submission
- [ ] BullMQ job: RaiderIO cross-verify 4 hours after submission
- [ ] Deploy all services to Unraid
- [ ] End-to-end smoke test: run a key → `/reload` → Discord embed in <30 sec

---

## External API Prerequisites

Before starting Sprint 1:

1. **Discord Application** — [discord.com/developers/applications](https://discord.com/developers/applications)
   - Create application, enable bot, copy `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID`
   - Enable: Server Members Intent, Message Content Intent
   - Add bot to your server with slash command permissions

2. **RaiderIO API** — No registration required for public endpoints
   - Base URL: `https://raider.io/api/v1`
   - `/characters/profile?region=us&realm=...&name=...&fields=mythic_plus_scores_by_season`

3. **GitHub Container Registry** — For Docker image hosting
   - Enable at `ghcr.io` via GitHub Packages settings
   - Configure `deploy.yml` Action with `GITHUB_TOKEN`

---

## Definition of Done (Each Sprint)

- [ ] All Vitest unit/integration tests pass
- [ ] TypeScript strict mode: zero errors across all packages
- [ ] Feature branch merged to `main`; Docker images built and deployed to Unraid
- [ ] All Prisma migrations applied cleanly (no manual SQL)
- [ ] Happy path smoke tested manually
- [ ] New DB tables/fields added to README data dictionary

---

## Key Design Decisions (Don't Revisit Without Good Reason)

| Decision | Rationale |
|----------|-----------|
| Discord signup (not in-game addon signup) | Enables cross-guild, cross-realm — impossible in-game without BattleTag friends |
| SavedVariables as the only data channel | The only legal write mechanism from WoW addon; TSM/WarcraftLogs pattern proves it works |
| Companion app as bidirectional bridge | Reads pendingRuns outbound; writes leaderboard data inbound. One process, two jobs. |
| Fastify over Express | 3× throughput; built-in JSON schema validation; plugin ecosystem matches our needs |
| SSE over WebSockets for live updates | Simpler infrastructure; one-way push is all leaderboard updates need; better for Vercel |
| PostgreSQL materialized views + Redis sorted sets | Views for season LBs (refresh per run); Redis ZADD/ZRANGE for weekly (auto-expire Tuesday) |
| RaiderIO cross-verification (4hr delay) | Fraud prevention without blocking run submission UX; lag is acceptable for integrity |
| Next.js on Vercel, API on Unraid | Zero-config Vercel deploy for web; existing Unraid infra for stateful services |

---

## Leaderboard Computation Strategy

```
Season leaderboards:
  → PostgreSQL materialized view, refreshed after each run submission
  → REFRESH MATERIALIZED VIEW CONCURRENTLY (non-blocking)

Weekly leaderboards:
  → Redis sorted sets: ZADD leaderboard:weekly:rising_star <score> <userId>
  → Auto-expire: keys set to expire at next Tuesday reset (UTC midnight)
  → ZRANGE ... REV WITHSCORES LIMIT 0 10 for fast top-10 queries

Event leaderboards:
  → Computed real-time from runs table WHERE event_id = ? AND recorded_at BETWEEN ...
  → BullMQ job re-computes every 5 min during active event window
  → SSE endpoint streams deltas to connected web clients
```

---

## Research Documents (Full Reference)

All design decisions in this file were derived from these documents. Review them for deep-dive rationale, code examples, and edge cases.

| Document | Content |
|----------|---------|
| `wow-mplus-discord-research.docx` | Discord bot architecture, RaiderIO API polling, `/lfm` command design |
| `wow-addon-backend-research.docx` | WoW addon sandbox constraints, SavedVariables pattern, companion app pipeline, full Lua/TS code examples |
| `wow-addon-extended-features.docx` | Inbound data channel, in-game group signup (guild-scoped), random selection, competition overlay design |
| `mplus-platform-workflow.docx` | End-to-end workflow, full database schema, matchmaking algorithm, web UI spec, incentive system |
| `mplus-devplan.docx` | Complete sprint roadmap, all event types, all LB categories, full badge catalog, Docker/Unraid setup |
