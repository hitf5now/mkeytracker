# Event Scoring & Hidden Feedback Pages — Plan

**Date:** 2026-04-15
**Source:** Plan agent audit of the M+ Challenge Platform monorepo

---

## 0. Grounding — what exists today

- `apps/api/src/services/scoring.ts` — `scoreRun()` is pure. Personal Juice = `keystoneLevel × 100 × timeModifier + bonuses`. Time modifiers `0.5/1.0/1.2/1.35/1.5`. Bonuses: noDeaths +150, personalDungeonRecord +200, personalOverallRecord +500, eventParticipation +100. Returns `ScoringBreakdown`.
- `apps/api/src/config/event-types.ts` — Sprint 12 Phase 1 registry. Lives at `src/config/`. Contains 7 types — the 4 in scope (`key_climbing`, `marathon`, `best_average`, `bracket_tournament`) plus `fastest_clear_race`, `speed_sprint`, `random_draft`. Registry publishes a `juiceTable` per type, but **no scoring code consumes any of these tables yet** — `runs.ts` only sets `isEventParticipation`.
- `apps/api/src/routes/runs.ts:296` — scoring call site (PR-bonus flags hardcoded `false`).
- `apps/api/src/routes/events.ts:619, 697` — `/event-types` listing endpoint and `getEventTypeConfig()` use on event detail.
- `apps/api/prisma/schema.prisma` — `Event` has `type EventType`, `mode EventMode`, `typeConfig Json?`, `discordGuildId String?`, `minKeyLevel`, `maxKeyLevel`, `dungeonId Int?`. `Run` has `personalJuice Int`. **No `eventJuice` or `teamJuice` column on Run, no per-event score-aggregate model, no `Juice` ledger table.**
- `apps/web/src/app/events/[id]/page.tsx:112-155` — auto-renders `typeInfo.rules`, `winCondition`, `scoringDescription`, `scoringTable`. **Existing inconsistency:** registry exports `juiceTable`, page reads `typeInfo.scoringTable`.
- `apps/web/src/components/event-create-form.tsx` — fetches `/api/v1/event-types`, organizer picks type, renders `configFields` (today only `runsToCount` for `best_average`).
- `packages/types/src/runs.ts` — `RunRecord.personalJuice` is the only Juice field.

**Key gap:** there is exactly one scoring function and it is type-agnostic. Phase 2 needs a typed dispatch — modifier hooks layered onto `scoreRun`, or a parallel `scoreEventRun(event, run, context)` function that returns Event Juice in addition to existing Personal Juice. Schema needs at least one new column on `Run` (event-scoped Juice) plus an aggregation model (`EventStanding`) to surface "who's winning" without heavy live recompute.

---

## 1. Per-event-type scoring proposals

All "Event Juice" formulas are intended **additive** to the existing `scoreRun()` Personal Juice, not a replacement. Personal Juice keeps flowing to the global leaderboard; Event Juice is a new column representing this run's contribution to the event's standings. Team Juice (when `event.mode === "team"`) is the team's roll-up of member Event Juice for that event, scoped to the event's guild.

### 1.1 key_climbing

Registry: "Peak level × 200 + Timed +500 + Clean +150 + Progression +50/lvl + Participation +100."

**Formula A — Peak Only (registry default, formalized).** Event Juice = `peakKey × 200 + (peakWasTimed ? 500 : 0) + (peakHadZeroDeaths ? 150 : 0) + max(0, peakKey − minKeyLevel) × 50 + 100`.
- *Sample:* min +10, peak +18 timed 0 deaths → `18×200 + 500 + 150 + 8×50 + 100 = 4750`.
- *Depleted peak +18:* `18×200 + 0 + 0 + 400 + 100 = 4100`.
- Tiebreakers: peak level → timed beats depleted → faster completion → fewer deaths.
- *Pro:* matches WoW's "highest key" mental model. *Con:* one good pull at the end erases earlier effort.

**Formula B — Peak + Climb Path Bonus.** A + `+25` per *distinct* key level cleared on the way up.
- *Sample:* timed +12, +14, +16, +17, +18 → `4750 + 5×25 = 4875`. Player who jumped to +18 from a friend's key → `4750 + 25 = 4775`.
- *Pro:* rewards the journey. *Con:* slightly punishes players whose first attempt is their peak.

**Formula C — Highest Three Keys, Weighted.** Event Juice = `0.6 × scoreRun(peak) + 0.3 × scoreRun(2nd) + 0.1 × scoreRun(3rd)`. Reuses `scoreRun()`.
- *Sample:* scoreRun totals 1950/1850/1750 → `1170 + 555 + 175 = 1900`.
- *Pro:* uses existing infra, reduces "one lucky timer" gaming. *Con:* harder to explain.

**Recommendation:** Ship Formula A (matches registry copy and current detail page). Optionally A+B as a `typeConfig.climbPathBonus: bool` toggle. Save C as a possible "Pro Mode" knob.

**Interaction with `scoring.ts`:** A and B add a new `eventJuiceForKeyClimbing(runs, event)` called *after* per-run `scoreRun()` and stored in `Run.eventJuice` (or aggregated into `EventStanding.eventJuice` and recomputed on each new run). Personal Juice still gets +100 participation. Tiebreakers live in standings query.

### 1.2 marathon

Registry: "every run counts; streak +100 per consecutive timed; variety +200 per unique dungeon; endurance +50 per run beyond the 5th."

**Formula A — Sum + Streak + Variety + Endurance (registry default).** Per-run Event Juice = `scoreRun().total + (consecutiveTimedSoFar × 100) + (firstClearOfDungeonInEvent ? 200 : 0) + (runIndex > 5 ? 50 : 0)`. Player Event Juice = sum.
- *Sample 6-run window:* timed +14 (run 1, new) = `1400 + 100 + 200 = 1700`. Timed +15 (run 2, streak 1, new) = `1500 + 150 + 100 + 200 = 1950`. Depleted +16 (run 3, reset, new) = `800 + 0 + 200 = 1000`. Etc.
- *Pro:* every new run rewarding; endurance self-balances. *Con:* dominated by raw run count.

**Formula B — Sum with Diminishing Returns.** Per-run × `(0.95 ^ (runIndex − 1))`. Streak/variety unchanged.
- *Pro:* caps grinder dominance. *Con:* punishes players who can't play early; complicates Discord notification copy.

**Formula C — Best N + Streak Multiplier.** Event Juice = `sum(top 10 runs) × (1 + 0.05 × longestStreak)`. Variety = flat `+200 × distinctDungeons`.
- *Pro:* quality-first, still rewards consistency. *Con:* changes shape entirely from registry.

**Recommendation:** Formula A. Add `typeConfig.endurancePerRun` and `typeConfig.streakBonus` for tuning. Edge cases: leaver mid-run → run never submits, no penalty. Depleted = 0.5× modifier. DNF → no row.

**Interaction with `scoring.ts`:** New `services/event-scoring/marathon.ts` that on each insert (a) calls `scoreRun()`, (b) reads player's prior runs in event for streak/runIndex, (c) writes `Run.eventJuice` and updates `EventStanding`. Streak state lives in queries → re-scoring is idempotent.

### 1.3 best_average

Registry: "average of top N runs (default 3); +300 if all timed; no consistency bonus if score spread > 500; must complete N to qualify."

**Formula A — Straight Average (registry default).** Event Juice = `mean(top N) + (allTimed ? 300 : 0) + 100`. Range gate just nullifies consistency bonus.
- *Sample N=3, totals 1850/1750/1700/1500/600:* mean of top 3 = 1766.67, all timed, range 150 → `1767 + 300 + 100 = 2167`.
- Edge: <N runs → unqualified, Event Juice = 0 / displayed "needs 1 more."

**Formula B — Trimmed Mean.** Drop highest and lowest, average middle. Requires N+2 runs.
- *Sample 5 runs:* drop 1850 and 600 → mean(1750/1700/1500) = 1650 → `1650 + 100 = 1750`.
- *Pro:* one bad run no longer caps you. *Con:* raises floor.

**Formula C — Weighted Top N.** `Σ weight_i × topN[i]` with weights `[0.5, 0.3, 0.2]` for N=3.
- *Sample:* `925 + 525 + 340 = 1790 + 300 + 100 = 2190`.
- *Pro:* peak still matters more than flat mean. *Con:* close to A in practice.

**Recommendation:** Formula A. Expose `runsToCount` (already there), add `consistencyBonus` and `spreadCap`.

**Interaction with `scoring.ts`:** Pure aggregator — `scoreRun()` doesn't change. `services/event-scoring/best-average.ts` recomputes from `Run` rows on each new submission. SELECT-ORDER-LIMIT feeding `bestAverageEventJuice(scores, config)`.

### 1.4 bracket_tournament

Registry: "match win +500, margin +100, placement Juice 2000/1200/800/400."

**Formula A — Per-Match + Placement (registry default).** Winning side per-match = `scoreRun() + 500 + (margin ≥ 20% ? 100 : 0)`. Loser gets only `scoreRun()`. Each player gets `placementJuice[finalRound]` at end.
- *Sample 4-team, win R1 by 25%, lose R2:* R1 win run scoreRun 1750 → `1750 + 500 + 100 = 2350`. R2 loss run 1700 → `1700`. Eliminated R2 → 4th, +400. Per-player = `2350 + 1700 + 400 = 4450`.
- Edge: bye → `0.5 × averagePlacementJuice`. Forfeit → opponent advances with default win bonus. Both DNF → lower seed loses. Leaver → forfeit.

**Formula B — Best-of-N Series.** Each round best-of-3 dungeons. Per-set = `scoreRun()`, +250 per set won, +500 match win.
- *Sample 2-1 R1:* `1700+1650+1500 + 250×2 + 500 = 5350` from R1 alone.
- *Pro:* mitigates affix luck. *Con:* ~3× the time per round.

**Formula C — Match Differential Scoring.** `(yourScore − opponentScore) + (won ? 500 : 0) + placement`. Cumulative differential = tournament tiebreaker.
- *Pro:* margin matters everywhere. *Con:* allows negative event-Juice — confuses casuals.

**Recommendation:** Formula A. Make `placementJuiceTable` and `marginThresholdPercent` configurable. Defer B and C to "competitive ruleset" follow-up.

**Interaction with `scoring.ts`:** New domain. New schema: `BracketMatch { eventId, round, slotA, slotB, winnerSlot, runAId, runBId }`. Per-match Event Juice in `services/event-scoring/bracket.ts` once both runs submit. Placement Juice awarded in finalize step.

---

## 2. Event-type descriptions for outside reviewers (non-technical)

### Key Climbing
Key Climbing is a "how high can you go?" event. Every group or team starts at the event's minimum keystone level — say, +10 — and tries to push their key as high as possible before the timer runs out. Each timed run rewards your group with the next key level, so a successful evening might look like +10, +12, +14, +16, +17.

Players experience it as a personal mountain. There's no rush against a clock; the question is "can we time this one?" and then "okay, can we time the next one too?" When a key gets depleted, you don't get bumped down — you can keep trying at that level or below. The drama is in the late-game pulls: at +18 with 90 seconds on the clock, do you risk one more pack?

Scoring is dead simple: only your highest completed key counts. Time it to feel great, deplete it and you still get credit for "reaching" that level. Bonus juice rewards how high you got, whether you timed your peak, and how clean your peak run was. The fun is the *climb* — the win is the *summit*.

### Marathon
Marathon is an endurance event. Every key your group runs during the event window earns juice — quantity matters as much as quality. Think four hours of back-to-back keys, with the leaderboard ticking up after every successful dungeon.

Players experience it as a long evening of focused play. Groups settle into a rhythm — pull, recover, queue the next key, go. Variety bonuses encourage you to rotate dungeons rather than farm the easiest one. A streak bonus rewards consecutive timed runs, so depleting a key hurts more than just a low score for that run — it breaks your momentum. Endurance bonuses kick in after your fifth run, so the sixth and seventh runs of the night are worth a little extra to keep folks pushing through fatigue.

Scoring stacks: every run earns its standard juice (key level × time bonus), plus extras for streaks, dungeon variety, and stamina. The win is the highest *total*. The fun is the rhythm and the camaraderie of a long session.

### Best Average
Best Average is a consistency event. You can run as many keys as you want, but only your top three (or however many the organizer set) count toward your final score — and your final score is the *average* of those three. One amazing run can't carry you. You need three good runs.

Players experience it as a "show your form" event. There's no point in farming +5s; you need to consistently put up your best. Mid-event, you watch your average and ask "can I beat my current 3rd-place run?" If you can't, that one's locked in and any worse run is just practice. Players who time five keys at +18, +18, +17, +17, +16 will outscore a player who timed one +20 and four +12s.

Scoring is the average of your best N runs. There's a consistency bonus if all of your top N are timed and within a tight score range. The win goes to the steadiest, most reliable player. The fun is in chasing your own ceiling.

### Bracket Tournament
Bracket Tournament is the head-to-head competitive format. Groups or teams are seeded by their average M+ rating, then matched up in a single-elimination bracket. In each round, both sides run the same dungeon at the same key level — the higher-scoring run advances. Lose a match, you're out.

Players experience it as a high-stakes evening. There's a clear narrative: round of 8, quarterfinals, semis, finals. Between rounds you can scout your opponent's previous run, talk strategy, swap a healer if you need to. The bracket is announced ahead of time so everyone knows their path.

Scoring layers a per-match component (juice for your run, plus a win bonus, plus a margin bonus if you blow them out by 20%+) with a placement component (1st, 2nd, 3rd–4th, 5th–8th all get tournament juice). The fun is the format — it's the only event type where you directly play against someone else's identical run, and the only one with a single, declared champion.

---

## 3. Workflow / mockup descriptions

**Recommendation across all four:** **Mermaid in MDX** for flowcharts/brackets/timelines (diff-friendly, PR-reviewable), and **Tailwind block layouts** for ranking/leaderboard previews and dungeon checklists. Hand-authored SVG only for the bracket if Mermaid feels too rigid.

### 3.1 key_climbing
- **Signup:** Discord embed or web event page. Picks character, role, spec.
- **During:** Group queues key at/above `minKeyLevel`. Run completes → addon submits → standings recompute → page shows new peak.
- **After:** Standings frozen at `endsAt`. Final peak per player.

Diagrams:
1. **Climb timeline** — horizontal stair-step per sample player. Mermaid `gantt` or Tailwind flexbox of badges with rising height.
2. **Scoring breakdown card** — Tailwind panel with the 5-line formula breakdown.

### 3.2 marathon
- **Signup:** Same. Players see ETA for window length.
- **During:** Continuous play. Per-run ephemeral Discord embed: "Run #4 — timed +15 — streak 3 — Event Juice +1850."
- **After:** Standings list all runs grouped by player with cumulative sparkline.

Diagrams:
1. **Stacked-run timeline** — horizontal blocks per run, color = timed/depleted, height = score. Tailwind flex.
2. **Dungeon variety checklist** — grid of season dungeons, checkmarks per player. Tailwind grid.
3. **Cumulative score line chart** — one line per player. Recharts (already in `apps/web` if present) or hand-rolled SVG.

### 3.3 best_average
- **Signup:** Same.
- **During:** New run either doesn't crack top N (stored, no movement) or cracks top N (average recomputed). UI shows "current top N" + "dropped run" — the *replacement* mechanic is the unique social hook.
- **After:** Final average locked. Unqualified players (<N runs) in separate list.

Diagrams:
1. **Top-N podium** — N stacked cards showing counted runs, dropped runs greyed below. Tailwind.
2. **Spread visualization** — number-line with N counted scores as dots, spread cap zone shaded green. Inline SVG ~30 lines.
3. **Worked example calc** — labeled formula box. Tailwind/MDX.

### 3.4 bracket_tournament
- **Signup:** Teams/groups locked before bracket generation at `signupClosesAt`.
- **Pre-event:** System generates bracket from RaiderIO seedings. Published as embed and web page. Byes assigned to top seeds.
- **During:** Round 1 simultaneous. Both sides run same dungeon at same level. Winner advances → bracket UI updates → Round 2 announced.
- **After:** Champion crowned, placement Juice distributed.

Diagrams:
1. **Bracket diagram** — single-elimination tree. Hand-authored SVG (~80 lines) or Tailwind grid with absolute connectors. Sample team names, round labels, highlighted winning path.
2. **Per-match score card** — two columns side-by-side with "Winner: A by 14% margin" callout. Tailwind.
3. **Placement Juice table** — 1st/2nd/3rd-4th/5th-8th. Tailwind.

---

## 4. Hidden web feedback pages plan

### 4.1 Route structure

- `apps/web/src/app/feedback/layout.tsx` — `metadata.robots = { index: false, follow: false }` + `<meta>` + `X-Robots-Tag: noindex` via Next middleware.
- `apps/web/src/app/feedback/page.tsx` — landing page listing 4 event types. Requires `?token=…`.
- `apps/web/src/app/feedback/events/[type]/page.tsx` — per-type review page.
- `apps/web/src/app/feedback/thanks/page.tsx` — post-submit confirmation.
- `apps/web/src/middleware.ts` — extend with `/feedback/*` matcher validating `?token=` against `FEEDBACK_TOKENS` env (comma-separated). Cookie set on first valid hit. **404 on miss** (not 403 — plausible deniability).

### 4.2 Page layout per event type

1. **Header:** event-type label + "Reviewer feedback" pill. Reviewer name in top-right.
2. **Description block:** the 2–3 paragraph plain-English description from §2.
3. **Workflow & mockups:** the diagrams from §3, statically rendered.
4. **Scoring options side-by-side:** card per formula with name, one-sentence summary, formula in mono, *worked example* using same sample run across all (apples-to-apples), pros/cons bullets.
5. **"Score this run" mini-calculator (optional):** sliders for keystone level, upgrades, deaths, on-time. Shows what each candidate formula outputs. Pure client-side, mirrors `services/event-scoring/*`.
6. **Vote/rank UI:** drag-to-reorder list (`dnd-kit`) or radio "favorite" + "least favorite."
7. **Rating sliders:** three 1–5 — "How fun?", "How clear?", "How competitive?"
8. **Comment box:** free-text, max 4000 chars.
9. **Submit button + email-receipt opt-in.**

### 4.3 Backend storage

```prisma
model EventFeedback {
  id                Int      @id @default(autoincrement())
  eventType         String   @map("event_type")
  reviewerName      String?  @map("reviewer_name")
  reviewerEmail     String?  @map("reviewer_email")
  scoringPreference String?  @map("scoring_preference")
  scoringRanking    String[] @default([]) @map("scoring_ranking")
  ratings           Json?    // { fun, clarity, competitiveness }
  comments          String?
  submittedViaToken String?  @map("submitted_via_token")
  submitterIpHash   String?  @map("submitter_ip_hash")  // /24 v4, /48 v6
  createdAt         DateTime @default(now()) @map("created_at")

  @@index([eventType, createdAt])
  @@index([createdAt])
  @@map("event_feedback")
}
```

API:
- `POST /api/v1/feedback` — Zod-validated. Server validates `eventType` against registry. Rate-limit: 5/hr per IP, 1 per (IP, eventType) per 5min. Token validated.
- `GET /api/v1/admin/feedback` — internal-auth. Optional `?eventType=` filter. Paginated newest-first.
- `GET /api/v1/admin/feedback/summary` — per-eventType vote counts, average ratings, comment count.

### 4.4 Admin review page

`apps/web/src/app/admin/feedback/page.tsx` — server-rendered, admin-gated (need `isAdmin` flag on `User` or hardcoded Discord-ID allowlist for v1).
- Top: per-event-type tabs with submission count badges.
- Per tab: sortable table — date, reviewer, preferred formula, ratings, comment-snippet expand-on-click.
- Sidebar: aggregate summary card — vote distribution stacked bar, average ratings.
- Export button: CSV download.

### 4.5 Auth model

**Recommendation: no Discord login. Optional name + email only.** Reasons: (a) reviewers include external designers — Discord OAuth adds friction; (b) shared-token gate already means it's an invited reviewer; (c) anonymity surfaces sharper criticism. Email collected only for follow-up. Show "Your name will be visible to the project maintainers; leave blank to submit anonymously."

### 4.6 Anti-spam

- Token gate (env-controlled allowlist of opaque ~16-char base32). Revoke by removing from env.
- Cloudflare Turnstile (or hCaptcha) on submit if URL leaks.
- Server-side: rate-limit by hashed IP /24 — 5 submissions/hr global, 1 per (IP, eventType) per 5min.
- Honeypot field `website` — bots fill, humans don't. Server silently rejects non-empty.
- Max body 8 KB. Fastify schema enforces.
- HTML-escape all rendered input. No raw HTML.

---

## 5. Interview questions

1. **Which scoring formulas do we ship?** My recommendation is "Formula A" for all four types (registry defaults, formalized). OK with shipping A only and using the feedback site to validate B/C as future options, or do you want B variants live on day one?
2. **Who are the reviewers?** M+ guildmates, external WoW community contacts, designers from outside WoW, or all three? Determines whether formal scoring math (Formula C) or vibes-based descriptions get more weight.
3. **Anonymous vs attributed feedback?** Defaulted to "name optional." OK with anonymous, or require at minimum a name (still no auth)?
4. **Feedback window length?** 1 week, 2 weeks, indefinite? Affects whether admin page is built now or later, and whether to add a `closedAt` per-type.
5. **Sample-data calculator?** I've recommended in-page "score this run" calculator. All four types, or only the more complex ones (marathon, best_average)?
6. **Personal vs Event vs Team Juice — explicit on feedback page?** Should the feedback page explain the three-pool model, or hide complexity and just show "Event Juice" examples?
7. **Token distribution?** Single shared token in env (simple, easy revoke), or per-reviewer tokens (better audit trail)?
8. **Rate limit thresholds — too strict?** 5 submissions/hr per IP could affect office or shared networks. Acceptable, or relax to 20?
9. **Bracket tournament best-of-3 (Formula B) — interest?** Only formula across all types that materially changes event duration. Want it as a candidate, or omit?
10. **Should the public events detail page link to feedback?** I assume no (feedback is hidden). Confirm? The link would defeat the noindex stance.
11. **Existing field-name inconsistency:** registry exports `juiceTable`, detail page reads `typeInfo.scoringTable`. Flag as a separate Phase-2 cleanup ticket or fold into feedback work?
12. **Schema additions — when?** `Run.eventJuice` and `EventStanding` are needed for any §1 formulas to be live. Are we shipping the feedback site *before* actual Phase 2 scoring (reviewers vote on hypotheticals), or in parallel?

---

## 6. Sprint 13 task breakdown — feedback site portion

**Recommendation: parallel sub-track.** Sprint 13's main thrust is the multi-tenant Discord bot work. The feedback site touches `apps/web` and a single new Prisma model — minimal overlap. Two engineers (or one alternating) can run them in parallel without merge conflicts. If only one engineer is available, **push feedback site to Sprint 14** — it is not blocking and has no user impact until ship.

Effort: **~3–4 days focused work**:

- **S13.F1 — Schema + migration (0.5d).** Add `EventFeedback` model. No backfill.
- **S13.F2 — API endpoints (0.5d).** `POST /feedback` with Zod, rate limiter, honeypot, IP hashing. `GET /admin/feedback` and `/summary` with internal-auth gate.
- **S13.F3 — Token gating + middleware (0.25d).** Extend `apps/web/src/middleware.ts` with `/feedback/*` matcher validating `?token=` against `FEEDBACK_TOKENS` env, sets cookie, 404 on miss. `noindex` in `feedback/layout.tsx`.
- **S13.F4 — Per-type page scaffolding (1d).** `feedback/events/[type]/page.tsx` reads from `EVENT_TYPE_REGISTRY` + new sibling `FEEDBACK_PROPOSALS` constant. Sections 1–4 from §4.2.
- **S13.F5 — Mockup diagrams (1d).** Per-type Mermaid/Tailwind/SVG diagrams from §3. Biggest single chunk.
- **S13.F6 — Vote/rank UI + ratings + form (0.5d).** Form state, validation, submit, error/success states, optional `dnd-kit`.
- **S13.F7 — In-page calculator (0.5d, optional per Q5).** Pure-client formula functions mirroring §1. Reactive to slider inputs.
- **S13.F8 — Admin page (0.5d).** `/admin/feedback` with tabs, table, summary card, CSV export.
- **S13.F9 — Anti-spam hardening (0.25d).** Turnstile, honeypot, body-size limit, audit log.
- **S13.F10 — QA + token issuance (0.25d).** End-to-end test, generate tokens, hand off.

**Total: ~5 person-days** with calculator; ~4.5 without.

**Dependencies:** F1 blocks F2. Everything else parallel. F4 depends on Interview Q1 answer. F8 depends on admin auth model — if no platform-wide admin role exists, F8 needs +0.25d for hardcoded Discord-ID allowlist.

---

## Critical Files for Implementation

- `apps/api/src/services/scoring.ts`
- `apps/api/src/config/event-types.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/src/app/events/[id]/page.tsx`
- `apps/web/src/app/middleware.ts`
- `apps/api/src/routes/events.ts`
