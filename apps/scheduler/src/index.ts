/**
 * Scheduler worker.
 *
 * Calls the time-based API sweeps on a recurring interval:
 *   - POST /api/v1/ready-checks/sweep-expired — expires RCs whose 5-min
 *     window has elapsed, forming groups atomically.
 *   - POST /api/v1/event-groups/sweep-timed-out — transitions `forming`
 *     groups to `timed_out` when they've sat for 2h OR the event has ended.
 *   - POST /api/v1/events/sweep-lifecycle — moves events between scheduled,
 *     in_progress and completed as their start/end times pass.
 *   - POST /api/v1/seasons/sync — reconciles the season + dungeon pool
 *     against upstream so an M+ season rollover doesn't silently break run
 *     submission (every run 404s once the dungeon pool changes).
 *
 * Runs independently of the API container so that a restart of the API
 * doesn't delay these transitions beyond one interval.
 */

const API_BASE = (process.env.API_INTERNAL_URL ?? "http://api:3000").replace(/\/$/, "");
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";

const READY_CHECK_INTERVAL_MS = 30 * 1000; // every 30s
const GROUP_TIMEOUT_INTERVAL_MS = 60 * 1000; // every 60s
const LIFECYCLE_INTERVAL_MS = 60 * 1000; // every 60s
// Seasons roll over a few times a year and Blizzard announces the date well
// in advance, so hourly is far more often than strictly needed — it just
// bounds how long submission can stay broken if a rollover lands unannounced.
const SEASON_SYNC_INTERVAL_MS = 60 * 60 * 1000; // every hour

if (!API_SECRET) {
  console.warn("[scheduler] API_INTERNAL_SECRET not set — sweeps will fail auth");
}

async function postInternal(path: string): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_SECRET}`,
    },
    body: "{}",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${url} → ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function runReadyCheckSweep(): Promise<void> {
  try {
    const r = (await postInternal("/api/v1/ready-checks/sweep-expired")) as {
      expiredReadyCheckIds: number[];
    };
    if (r.expiredReadyCheckIds.length > 0) {
      console.log(
        `[scheduler] expired ${r.expiredReadyCheckIds.length} ready check(s): ${r.expiredReadyCheckIds.join(", ")}`,
      );
    }
  } catch (err) {
    console.error("[scheduler] ready-check sweep failed:", err);
  }
}

async function runGroupTimeoutSweep(): Promise<void> {
  try {
    const r = (await postInternal("/api/v1/event-groups/sweep-timed-out")) as {
      timedOutGroupIds: number[];
    };
    if (r.timedOutGroupIds.length > 0) {
      console.log(
        `[scheduler] timed out ${r.timedOutGroupIds.length} group(s): ${r.timedOutGroupIds.join(", ")}`,
      );
    }
  } catch (err) {
    console.error("[scheduler] group-timeout sweep failed:", err);
  }
}

async function runLifecycleSweep(): Promise<void> {
  try {
    const r = (await postInternal("/api/v1/events/sweep-lifecycle")) as {
      started: number[];
      completed: number[];
    };
    if (r.started.length > 0) {
      console.log(`[scheduler] started event(s): ${r.started.join(", ")}`);
    }
    if (r.completed.length > 0) {
      console.log(`[scheduler] completed event(s): ${r.completed.join(", ")}`);
    }
  } catch (err) {
    console.error("[scheduler] lifecycle sweep failed:", err);
  }
}

async function runSeasonSync(): Promise<void> {
  try {
    const r = (await postInternal("/api/v1/seasons/sync")) as {
      action: string;
      reason: string;
      seasonSlug?: string;
      previousSeasonSlug?: string;
    };
    // `noop` is the steady state — logging it hourly would bury real events.
    if (r.action === "noop") return;
    if (r.action === "activated") {
      console.log(
        `[scheduler] 🔄 SEASON ROLLOVER — ${r.previousSeasonSlug ?? "none"} → ${r.seasonSlug}: ${r.reason}`,
      );
    } else {
      console.log(`[scheduler] season sync (${r.action}): ${r.reason}`);
    }
  } catch (err) {
    console.error("[scheduler] season sync failed:", err);
  }
}

console.log(
  `[scheduler] starting — RC sweep every ${READY_CHECK_INTERVAL_MS / 1000}s, group-timeout every ${GROUP_TIMEOUT_INTERVAL_MS / 1000}s, lifecycle every ${LIFECYCLE_INTERVAL_MS / 1000}s, season sync every ${SEASON_SYNC_INTERVAL_MS / 60000}min, target ${API_BASE}`,
);

// Kick off once immediately so startup doesn't wait a full interval.
void runReadyCheckSweep();
void runGroupTimeoutSweep();
void runLifecycleSweep();
void runSeasonSync();

const rcTimer = setInterval(() => void runReadyCheckSweep(), READY_CHECK_INTERVAL_MS);
const groupTimer = setInterval(() => void runGroupTimeoutSweep(), GROUP_TIMEOUT_INTERVAL_MS);
const lifecycleTimer = setInterval(() => void runLifecycleSweep(), LIFECYCLE_INTERVAL_MS);
const seasonTimer = setInterval(() => void runSeasonSync(), SEASON_SYNC_INTERVAL_MS);

function shutdown(signal: string): void {
  console.log(`[scheduler] ${signal} received, shutting down`);
  clearInterval(rcTimer);
  clearInterval(groupTimer);
  clearInterval(lifecycleTimer);
  clearInterval(seasonTimer);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
