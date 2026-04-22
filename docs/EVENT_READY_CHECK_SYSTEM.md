# Event Signup & Ready Check System — Design Spec

**Status:** Design locked, implementation deferred
**Author notes:** Captured from design conversation on 2026-04-21 following event #8 retrospective
**Supersedes:** Current "Assign Groups" flow (manual admin-triggered group formation with binary signup status)

---

## 1. Why we're rebuilding this

The current event flow has four problems that event #8 exposed:

1. **Bottleneck math is brutal and invisible.** With 3T/3H/5DPS, the greedy matcher forms 1 group and benches 6 players — even though 3T/2H/6DPS would form 2 groups and bench 1. The admin has no visibility into what would fix it and no way to course-correct without asking someone to change their role.
2. **PUG groups are malformed.** When DPS is the limiting role, leftovers get dumped into a single "PUG" group with compositions like 2T/2H/2DPS that can never run a valid key. The system produced it, but it can never actually play.
3. **Re-clicking Assign Groups is destructive and untracked.** Each click creates fresh group rows, re-shuffles signups, and leaves orphaned empty rows in the DB. Event #8 has 4 orphaned empty group rows as an artifact of three rapid-fire reassignment attempts.
4. **Group composition is locked for the week.** If a group forms on day 1 and one player can't play on day 2, the other four have no legitimate path to complete another run for the event. A single unavailable player benches the whole group.

The fix is a reframing, not a patch: **events are a roster pool; groups form dynamically per run; nobody is locked into a fixed roster for the week.**

---

## 2. Core principles

| Principle | What it means |
|---|---|
| **Signups are interest, not commitment** | Signing up adds you to the event roster. That's it. Signups never close until the event is Complete. Late signups are normal, not exceptional. |
| **Ready Check is the forming mechanism** | Explicit "I'm playing right now" signal, bounded by a timer, that produces groups. Called "Ready Check" to mirror in-game terminology. |
| **Groups are ephemeral** | A group is formed per Ready Check, plays one run, and is done. No multi-run group identity (except for events that need it — see §12). |
| **Skeleton composition is enforced** | Every group is exactly 1 Tank / 1 Healer / 3 DPS. No other composition is representable. Open slots are first-class; pickup players fill them in-game. |
| **Only signups + Ready Check earn credit** | Event credit requires (a) being signed up and (b) being assigned to a skeleton slot via Ready Check. In-game pickups get no event credit. |
| **Fully automated** | No admin button-clicks needed to form groups. The Ready Check loop runs itself. |
| **Discord is the live surface; web is the record** | All real-time action happens on Discord (signup, RC, group formation, disband). The website shows history, runs, and results. |

---

## 3. Event lifecycle

```
Draft ─────► Posted ─────► In Progress ─────► Complete
  │            │                │                │
(web only)  (posted to      (startsAt,        (endsAt OR
            Discord;         RC enabled,       admin close;
            signups          signups still     RC + signups
            open)            open)             locked; results
                                               posted)
```

- **Draft** — admin creates event on the web. Not yet visible in Discord.
- **Posted** — admin publishes; bot posts the event embed to the server's events channel. Signups open. Ready Check not yet available.
- **In Progress** — auto-transition at `startsAt`. Ready Check button goes live. Signups remain open throughout.
- **Complete** — auto-transition at `endsAt`, or admin manual-close from the web (to end early). Ready Check and signup both lock. Results post with top 3 groups and links to their runs.

Admin can also **Repost** an active event from the web to re-surface the embed if it gets buried in channel history. Repost appends a pointer message; it does not delete or replace the original embed.

---

## 4. Signup

Signup captures:
- **Primary role** — `tank` / `healer` / `dps` (required, same as today)
- **Flex role** — one of: `tank`, `healer`, `dps`, or `none` (required; "none" is a valid answer)

Signups are open during Posted and In Progress. A signed-up player is in the event roster. Being in the roster does not obligate them to play any particular session — they play when they Ready Check.

**Who can sign up:** anyone who has a claimed character on the platform. Signup is per-event, per-user.

**Changing signup:** a player can change role/flex at any time. Changes apply to future Ready Checks only; they don't affect groups already formed.

---

## 5. Ready Check mechanic

Ready Check is the only way to form a group during an event.

### 5.1 Initiation

- Any signed-up player can click the **Ready Check button** on the event embed (Discord).
- First click starts a 5-minute countdown window and posts a new **Ready Check message** in the event channel. The clicker is the first member of the RC queue.
- Subsequent clicks (on either the event embed's button or the Ready Check message's button) add the clicker to the active queue. They do not start new windows.
- **Only one Ready Check is active per event at a time.**
- Non-signed-up users who click the button get a "sign up first" error response.

### 5.2 During the window

- The Ready Check message shows:
  - Live countdown timer
  - Currently checked-in roster with roles (including flex marker)
  - The Ready Check button (for others to join)
- Players can **cancel their participation** during minutes 0–4. The final 1 minute is locked to prevent mis-click cancellations.
- The event embed's button text updates to "Join Ready Check (2:14 left)" while a window is active, and reverts to "Start Ready Check" after the window ends.

### 5.3 Expiry

At the 5-minute mark, the system forms groups greedily using the skeleton rules (§6), updates the Ready Check message to show the formed groups or a failure message, and releases the event for another Ready Check to be started.

### 5.4 Concurrency

- **Within an event:** one active RC at a time. Cannot start a new one until the current one closes.
- **Across events:** a player cannot be in two active Ready Checks simultaneously.
- **While assigned to a locked group:** a player cannot join a new Ready Check. The lock releases when the group's run is associated, the group is vote-disbanded, or the 2-hour idle timeout fires.

---

## 6. Skeleton formation rules

### 6.1 The invariant

Every group is exactly **1 Tank slot + 1 Healer slot + 3 DPS slots**. No other composition is representable in the data model. Slots are either:
- **Filled** — occupied by a real (event-signed-up) player
- **Open** — the slot is a PUG seat, to be filled by an in-game pickup

### 6.2 Greedy formation

At Ready Check expiry, the system:

1. Bins the checked-in pool by primary role
2. Computes `maxGroups = min(tanks, healers)` — tank and healer are the scarce anchors
3. If DPS count is insufficient, remaining DPS slots become open (PUG) slots
4. Pulls flex-role players to unlock additional skeletons when doing so increases the group count (e.g., a "DPS, flex: Healer" player is pulled as a healer if no other healer is available)
5. Creates as many skeletons as the anchor math allows
6. Assigns **priority-flagged** players first when slotting roles (§8)
7. Discards any skeleton that ends up with fewer than 2 real players; those players are bounced back to the pool

### 6.3 Flex pull rules

- Primary role is always used first
- Flex is pulled only when doing so unlocks an additional complete skeleton
- A flexed player is assigned to their flex role for that group; they have no decline option — if they don't like it, they can vote to disband after assignment
- A player is counted once per Ready Check (either primary or flex, never both simultaneously)

### 6.4 Outcome table

| Ready Check pool | Outcome |
|---|---|
| 1 player, any role | No group. Message: "Minimum 2 players required for a group." |
| 2 players forming a valid skeleton (any role combo except 2 players of same role) | 1 skeleton with 3 open slots. No priority flag (they're assigned). |
| 2 players, same role × 2 (e.g., 2T or 2H) | No valid skeleton (only 1 slot of that role per group). Both bounced with "enable flex" nudge. |
| 2 DPS | 1 skeleton with 1T + 1H + 1DPS slots open. Both assigned. |
| 5 balanced (1T/1H/3D) | 1 full skeleton. No open slots. |
| 10 balanced (2T/2H/6D) | 2 full skeletons. |
| 11 = 2T/2H/7D | 2 full skeletons + 1 leftover DPS. Leftover priority-flagged. |
| 12 = 2T/2H/8D | 2 full skeletons + 2 leftover DPS. The 2 leftover DPS form a 3rd skeleton with 1T, 1H, 1DPS open. All assigned. |
| 11 = 3T/3H/5D | 3 skeletons: Group 1 full (1T/1H/3D), Group 2 (1T/1H/2D + 1 open DPS), Group 3 (1T/1H + 3 open DPS). All 11 assigned. |
| 10T (10 tanks, 0 healers, 0 DPS) | No valid skeleton (each could only hold 1 tank, which fails the 2-player-min rule). All 10 bounced with "enable flex" nudge. |
| 0 players in window | Window closes silently. |

---

## 7. Groups

### 7.1 State model

A group has one of these states:

- `forming` — newly assigned by Ready Check, not yet matched to a run
- `matched` — a run has been associated (terminal; can no longer disband)
- `disbanded` — vote-disbanded before a run was associated (terminal)
- `timed_out` — auto-disbanded after 2h idle (terminal)

### 7.2 Vote to disband

- Any 2 members of the group can vote to disband
- Available while state is `forming` (before any run is associated)
- Disbanding releases all 5 members back to the pool; they can Ready Check again
- Disbanded groups are hidden from the web UI

### 7.3 Auto-disband (idle timeout)

- If a group in `forming` state has no run associated 2 hours after assignment, it auto-disbands
- At 1h45m (15 minutes before timeout), each member receives a Discord DM: "Your group hasn't logged a run — auto-disband in 15 minutes. [Keep group alive] to extend."
- Keep-alive extends the timer by another 2 hours (resets the clock)
- At 2h with no run and no keep-alive, group transitions to `timed_out` and all members are released

### 7.4 Lock

- A player assigned to a `forming` group **cannot** start or join a new Ready Check
- The lock releases when the group reaches any terminal state (`matched`, `disbanded`, or `timed_out`)
- The lock is per-group, not per-RC batch: if one RC produces Group A and Group B, Group A's completion/disband releases its members independently of Group B

---

## 8. Priority flag

A temporary flag on a signup that gives preferential treatment in the next Ready Check.

### 8.1 Who gets it

- A player who was in a Ready Check **but was not assigned to any group** because:
  - They were the only person in the window (solo)
  - Their role mix with others didn't permit any skeleton (e.g., 10 tanks scenario)
  - They were one left-over who couldn't fit into any skeleton (e.g., the single benched tank in a 2T/2H/6D+1T = 9-person pool... wait, that's 3T/2H/6D, which forms 2 full skeletons + 1 bounced tank)

### 8.2 Who does NOT get it

- Players assigned to a skeleton (even one with open slots) are **not** priority-flagged — they got a group
- Players who canceled their participation voluntarily
- Players who were vote-disbanded

### 8.3 How it works

- On the next Ready Check that includes this player, they are slotted into a skeleton **first** (before non-flagged players of the same role)
- This makes it structurally unlikely for them to be bounced twice in a row
- The flag clears the moment they are assigned to a skeleton

---

## 9. Run-to-event matching (1:1 rule)

### 9.1 The matching rule

A completed M+ run associates to an event group if and only if:

1. The event is in `In Progress` status
2. The run's dungeon + key level satisfies the event's rules
3. All 5 **real members** of an unmatched (`forming`) skeleton are present in the run's member list (character-level match)
4. The run's `completedAt` is ≥ the group's `assignedAt` (temporal filter — a group can't inherit a run that completed before the group existed)
5. The group has no run already associated

### 9.2 Consequences

- **1:1 within an event:** a group can be associated to at most one run. Once `matched`, further runs by those same players don't re-credit the same group — they search for a different unmatched group.
- **Cross-event:** a single run **can** credit multiple events simultaneously, one match per event. If 5 players are in Ready Check groups in two events and all match, both events credit the run to their respective groups.
- **No RC group = no credit:** if 5 event-signed-up players run a key together without having Ready Checked as a group, the run does **not** credit the event. Ready Check is the gate for credit.
- **Pickups don't matter:** if a group has 3 real + 2 open slots, and the 2 open slots get filled in-game by non-event players, the run still matches the skeleton if the 3 real members are all in the run. The pickups get combat stats but no event credit.

### 9.3 Race conditions

- When a run is uploaded, the matcher atomically sets the group's state to `matched` and associates the run. This prevents two concurrent uploads from each "winning" the same group.

---

## 10. Multi-run teams (character-level aggregation)

Some event types (`marathon`, `best_average`) require a team to complete multiple runs. Since groups are per-RC and ephemeral, these events aggregate multiple groups into a scoring "team" when the same 5 **characters** appear across them.

### 10.1 The rule

- For events with `aggregatesMultipleRuns = true` (e.g., marathon, best_average):
  - Two matched groups belong to the same scoring team if their 5 real-member **character IDs** are identical (set equality)
  - Specs may differ between runs (Kua-Balance on run 1, Kua-Feral on run 2) — same character
  - Different characters means different team (Kua swaps to Rogue character → new team for scoring purposes)

### 10.2 Consequences

- Teams for multi-run events self-organize: the same 5 people Ready Check together twice → their 2 groups aggregate into 1 team with 2 runs credited
- Mixing rosters resets the team. This is intentional: it preserves the "play with who you ready-check with" principle while still rewarding repeat collaboration.

---

## 11. Discord UX

### 11.1 Two-message architecture

**Event embed (persistent)** — posted when event transitions Posted; stays in channel until Complete.

- Fields: event name, type, description, times, key range, dungeon, season
- Live signup roster (updates on each signup)
- Ready Check button (text adapts to active state)

**Ready Check message (ephemeral per RC)** — new message posted each time a Ready Check starts; stays in channel as historical record.

- Live countdown
- Checked-in roster with role icons
- Join Ready Check button (same action as event embed's button)
- On expiry, content flips to "Groups Assigned" with the group roster(s)
- Disband and vote UI on the post-expiry form

### 11.2 All buttons, no slash commands

Every user-facing Ready Check action is a button. No slash command required. The only slash commands remain admin-side (event creation, admin overrides) and are explicitly out of scope for the Ready Check flow.

### 11.3 Embed constraint awareness

Discord embeds cap at 6000 chars; rapid re-renders can rate-limit. The two-message split reduces content pressure on either individual message. Live countdown updates should be throttled (e.g., every 30s) to stay within rate limits.

---

## 12. Web UX

The website is the historical record, not the live play surface.

### 12.1 Event detail page

- Event metadata (name, type, description, times, key range)
- Signup roster (by role, with flex markers)
- **Formed groups** — chronological list of matched + timed-out + forming (non-disbanded) groups, each showing members and the associated run (if any)
- Disbanded groups are hidden from the public view
- For events aggregating multiple runs (§10): team groupings shown as the top-level section, with their constituent groups/runs nested

### 12.2 Admin-only controls

- Create event (Draft → Posted)
- Repost event (append pointer message in Discord)
- Manual close (Complete early, before endsAt)

### 12.3 Results page (event Complete)

- Top 3 groups (or teams for multi-run events), ranked by the event's scoring formula
- Each with roster, run link, and scoring breakdown

---

## 13. Implementation ordering (when we build)

Not a schedule — just the dependency order.

1. **Schema migration**
   - Add `flex_role` to `event_signups`
   - Add `priority_flag` to `event_signups` (boolean, clears on assignment)
   - Change `event_groups` to include `state` enum (`forming` / `matched` / `disbanded` / `timed_out`) and `assigned_at` (already present)
   - Add `ready_checks` table: `id`, `event_id`, `started_at`, `expires_at`, `state` (`active` / `expired`), `started_by_user_id`
   - Add `ready_check_participants` table linking user/signup to ready check
   - Explicit slot model on `event_groups`: one row per slot (tank, healer, dps1, dps2, dps3) OR keep signup.group_id + position. Decide during schema design.
   - Remove `signups_closed` event status; update enum

2. **Matchmaking service rewrite** (`matchmaking.ts`)
   - Skeleton-based (always produce 1T/1H/3DPS frames)
   - Flex-aware bipartite matching
   - Priority-flag-aware slotting
   - Returns skeletons with explicit open-slot markers

3. **Ready Check service + API**
   - Start/join/cancel/expire lifecycle
   - Timer management (scheduled jobs)
   - Atomic expiry → group creation transaction
   - Redis pub/sub to bot for live updates

4. **Bot**
   - Button-based event embed (replace current signup flow)
   - Ready Check message with live countdown (rate-limited)
   - Group assignment post + disband UX
   - DM for 15-min auto-disband warning

5. **Run-event matcher rewrite** (`event-matcher.ts`)
   - 1:1 group-to-run association
   - Temporal filter
   - Atomic state transition on match
   - Cross-event support (match to multiple events simultaneously where applicable)

6. **Web UI**
   - Signup page updates: flex role required
   - Event detail: formed groups view, hide disbanded
   - Multi-run team aggregation view
   - Admin repost button
   - Admin manual-close action
   - Results page for Complete events

7. **Event-type scheduler**
   - Auto-transition Posted → In Progress at `startsAt`
   - Auto-transition In Progress → Complete at `endsAt`
   - 2h group idle-timeout worker with 15-min DM warning
   - Ready Check expiry worker

---

## 14. Open / deferred items

Things we noted but didn't make decisions on — revisit before implementation starts.

- **Open-slot claim mechanic.** Can a non-event-signup on the server click "claim an open DPS slot in Group 2" to join the in-game invite workflow? Or are open slots purely informational and filled via out-of-band channels (guild, LFG, whisper)? Current spec: purely informational. Future enhancement possible.
- **Keep-alive mechanic for auto-disband.** Is the "extend 2 more hours" button a good idea, or does it create ghost-group fatigue? Could be removed in favor of strict 2h limit.
- **Priority-flag lifetime.** Currently clears only on assignment. What if a priority-flagged player never Ready Checks again? The flag becomes an abandoned artifact. Consider clearing at event Complete.
- **Multi-event Ready Check conflict.** A player is signed up for Event A and Event B; both are In Progress. They click Ready Check on Event A. Are they eligible for Event B's Ready Check too? Current spec: a player can only be in one active Ready Check at a time.
- **Embed rate limits.** Live countdown updates need to be throttled. Specific rate (every 30s? every 60s?) to be tuned during bot implementation.
- **Dungeon specificity.** Some events target specific dungeons, some allow any dungeon. The skeleton/RC mechanic doesn't change either way — dungeon choice happens in-game, and the run-matcher filters by dungeon. Worth confirming no UX implication.
- **Bracket tournaments and fastest_clear_race.** These are team-mode events and do not use Ready Check. Spec above applies to group-mode events only.

---

## 15. Glossary

- **Event roster** — the set of players who have signed up for an event
- **Ready Check (RC)** — the 5-minute timed window during which signed-up players signal they want to play now
- **Skeleton** — a 1T/1H/3DPS group frame; slots are filled or open
- **Open slot** — a seat in a skeleton with no real event player assigned; filled by in-game pickup (no event credit)
- **Filled slot** — a seat occupied by an event-signed-up player (eligible for event credit)
- **Priority flag** — a temporary marker on a signup that gives them preferential slotting in the next RC
- **1:1 matching** — a group is associated with at most one run; a run may credit multiple events but only one group per event
- **Team (multi-run events only)** — a scoring entity formed by aggregating multiple groups that share the same 5 character IDs
