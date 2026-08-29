# Sprint Backlog — Next Actions

> Running list of upcoming sprints in priority order. Active sprints are tracked in `MEMORY.md` (see `project_sprint*` entries). Move items here when scoped but not yet started; remove when a sprint becomes active.

---

## Upcoming

### Sprint 17 — Battle.net account linking & character roster sync
- **Status:** Scoped, not started
- **Plan:** [`docs/SPRINT_17_BATTLENET.md`](./SPRINT_17_BATTLENET.md)
- **Goal:** Discord-authenticated users can link a Battle.net account to auto-import their full WoW character roster (name, realm, region, class, level, race, faction). Re-link / "Rescan" pulls fresh data on demand.
- **Reuses existing infra:** `BLIZZARD_CLIENT_ID`/`BLIZZARD_CLIENT_SECRET` (same dev app as portraits), NextAuth v5 Discord provider, `User.battleTag` field, existing `Character` model.
- **New infra:** `BattleNetAccount` Prisma model, `CharacterOwnershipLog`, three new nullable Character fields (`level`, `race`, `faction`), `apps/api/src/routes/battlenet.ts`, `/account/battlenet` web page.
- **Phases:** A) schema + API, B) web UI, C) polish (error states, CSRF, ownership audit).
- **Open questions to settle before code:** BattleTag uniqueness collision guard (Q4 in plan) — needs uniqueness constraint or pre-flight check in Phase A migration. 5 other questions deferrable.

### Sprint 18 — AI Coaching v1 (WCL-augmented)
- **Status:** Scoped, not started. Validated end-to-end via 4 POC iterations on real production runs.
- **Plan:** [`docs/AI_COACHING_UX_PLAN.md`](./AI_COACHING_UX_PLAN.md), session learnings in [`docs/AI_COACHING_LEARNINGS.md`](./AI_COACHING_LEARNINGS.md)
- **Goal:** For runs that have a matching WarcraftLogs report, generate per-player and group-level coaching recommendations with metric + source + evidence. Renders on a new `/runs/[id]/coaching` tab.
- **Architecture:** Deterministic Tier-1 analyzer → structured `recommendations[]` array → qwen3:14b Tier-2 prose synthesis (chunked, recommendation-driven, fact-checked). LLM is decoration; structured findings are source of truth.
- **Key dependency:** Per-run talent loadout fetched from Blizzard Profile API at run-submission time, with mandatory spec/class match validation. Players whose loadout can't be verified are skipped (disclosure card on page).
- **New infra:** `RunCoaching`, `RunRecommendation`, `PlayerRunLoadout`, cached `TalentNode` Prisma models. Redis job queue for async coaching generation. Ollama client for `qwen3:14b`. Coaching tab + rec card components on the run detail page.
- **Phases:** A) loadout fetch + spec validation (3-4 days), B) deterministic analyzer + structured recs (3-4 days), C) chunked qwen3:14b pipeline + fact check (2 days), D) web UI (3-4 days), E) polish (2 days). **Total: ~13-16 dev days.**
- **Coverage caveat:** ~20% of runs match WCL in our sample. Sprint 19 closes that gap.

### Sprint 19 — Companion combat-log upload + 30-day blob retention
- **Status:** Scoped for future investigation. Depends on Sprint 18 completing first.
- **Plan:** [`docs/SPRINT_19_COMBAT_LOG_UPLOAD.md`](./SPRINT_19_COMBAT_LOG_UPLOAD.md)
- **Goal:** Eliminate WCL coverage gap by capturing the relevant `WoWCombatLog.txt` slice via the companion app, uploading to server-side blob storage, and feeding it through the same coaching pipeline as WCL data.
- **Retention:** 30-day default with per-run pin support; nightly prune cron; storage-budget guardrail with auto-shorten.
- **Storage backend:** start with filesystem on Unraid (`/mnt/user/appdata/mplus-platform/combatlogs/`), migrate to MinIO when file count grows.
- **Why blob (not parsed extract only):** re-parseability when the parser improves, re-coaching when the analyzer improves, audit/debug, optional WCL re-upload on player's behalf.
- **Phases:** A) companion capture (3-4 days), B) server ingestion + Prisma model (2-3 days), C) retention cron + budget guardrail (1-2 days), D) analyzer integration parity-testing (2-3 days). **Total: ~8-12 dev days.**
- **Open questions to settle:** privacy disclosure UX, slicing strategy across back-to-back keys, opt-in vs opt-out, re-analyze trigger UX.

### Sprint 20 — Leaderboard follow-ups
- **Status:** Scoped, not started. Everything here is a follow-up to the leaderboard expansion shipped 2026-08-29 (15 boards + per-dungeon fastest clears, class/role filters, Class Champions wall). See `project_leaderboard_registry` and `project_leaderboard_visual_design` in MEMORY.md.
- **Goal:** Close the gaps the expansion deliberately left open, in rough priority order.

**1. Season 2 combat boards are empty — needs a manual backfill (blocking, ~5 min).**
- Six of the fifteen boards (Most Interrupts, Interrupts/Run, Most Dispels, Best DPS, Most Healing, Most Damage Soaked) read from combat-log enrichment, and Midnight S2 has **1 of 12 runs enriched**.
- Root cause was fixed in companion 0.7.3 (log files are now matched to a run's `serverTime` instead of always taking the newest). New runs enrich correctly; the historical backlog does not.
- **Action:** click **Backfill combat stats** on the companion dashboard. It now scans 30 days / 12 log files rather than only the newest. This is a button press, not a code change.
- Until then those boards correctly show an empty state explaining that combat data is missing — they are not broken.

**2. Best DPS favours key pushers.**
- `best-dps` ranks total damage ÷ run seconds. Higher keys have more enemy health, so the board partly measures key level rather than player output. Shipped unnormalised deliberately — that is how DPS is conventionally read in WoW — and the board description says so.
- **Options:** normalise per keystone level, weight by key level, or split into brackets. One-line change to the aggregate in `services/leaderboards.ts` once a rule is chosen.
- **Decide first:** which of those actually reflects how the community wants to compare.

**3. No rank history — blocks "movement" anywhere it would be useful.**
- The platform stores current standings only. This is why the addon's login digest reports *"You are #1 of 45 on Season Juice"* rather than the *"you moved to #2, Angrybeavor passed you"* framing from the original brainstorm — there is nothing to diff against.
- **Needs:** a small snapshot table (character, board, season, rank, capturedAt) written by the scheduler daily, plus a lookback query.
- **Unlocks:** movement arrows on the leaderboards page, real "since you last played" standings in the addon digest, and week-over-week trends.

**4. Per-dungeon fastest-clear boards are reachable but unsurfaced.**
- They exist in the rail under "Fastest clear" and work, but nothing points a first-time visitor at them. Consider surfacing the current season's records on the leaderboards landing state or the dashboard.

**5. Season pickers missing on `/events` and `/juice`.**
- Every other season-scoped page got one in the 2026-08-29 pass. `/events` was skipped because events are time-bound and ageing out anyway; `/juice` is explanatory copy with no season-scoped data. Listed for consistency, not urgency.

**6. Realm values in `characters` are not consistently slugged.**
- Rows exist reading `Trollbane` (capitalised) and `aeriepeak` (missing its dash) alongside proper slugs. Harmless to the addon since both sides now collapse every separator (see `project_addon_inbound_channel`), but it can produce duplicate character rows on the platform side.
- **Action:** one-off normalisation migration through `toRealmSlug`, plus a merge pass for any duplicates it reveals.
