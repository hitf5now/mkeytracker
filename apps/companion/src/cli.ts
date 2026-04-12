/**
 * Companion CLI entry point.
 *
 * Dev / smoke-test runner for the companion engine before the Electron
 * shell exists. Runs the watcher + queue against a real SavedVariables
 * file path and logs everything to stdout.
 *
 * Subcommands:
 *   pair <code>      — exchange a pairing code for a JWT (first-run flow)
 *   watch <path>     — watch a SavedVariables file, POST runs as they appear
 *   parse <path>     — one-shot parse + validate, no POST (for debugging)
 *   config           — print the companion's current config (JWT redacted)
 *
 * Env:
 *   COMPANION_API_BASE_URL  — override the apiBaseUrl in config
 *
 * Usage:
 *   npm run cli --workspace=@mplus/companion -- pair 123456
 *   npm run cli --workspace=@mplus/companion -- watch "C:/Path/To/MKeyTracker.lua"
 *   npm run cli --workspace=@mplus/companion -- parse "C:/Path/To/MKeyTracker.lua"
 *   npm run cli --workspace=@mplus/companion -- config
 */

import { CompanionApiClient, CompanionApiError } from "./core/api-client.js";
import { configPath, loadConfig, updateConfig } from "./core/config.js";
import { RunQueue } from "./core/queue.js";
import { parseSavedVariablesFile } from "./core/sv-parser.js";
import { SavedVariablesWatcher } from "./core/watcher.js";

function makeApiClient(): CompanionApiClient {
  const cfg = loadConfig();
  const baseUrl = process.env.COMPANION_API_BASE_URL ?? cfg.apiBaseUrl;
  return new CompanionApiClient(baseUrl, cfg.jwt);
}

async function cmdPair(code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) {
    console.error("Pairing code must be 6 digits.");
    process.exit(2);
  }
  const client = makeApiClient();
  try {
    const result = await client.exchangeLinkCode(code);
    updateConfig({
      jwt: result.token,
      jwtExpiresAt: result.expiresAt,
    });
    console.log("✅ Paired successfully.");
    console.log(`   User:       ${result.user.id} (discord ${result.user.discordId})`);
    console.log(`   Expires:    ${result.expiresAt}`);
    console.log(`   Config at:  ${configPath()}`);
  } catch (err) {
    if (err instanceof CompanionApiError) {
      console.error(`❌ Pairing failed: ${err.code} — ${err.message}`);
    } else {
      console.error("❌ Pairing failed:", err);
    }
    process.exit(1);
  }
}

async function cmdParse(path: string): Promise<void> {
  try {
    const result = parseSavedVariablesFile(path);
    console.log(`Parsed ${result.runs.length} valid run(s), ${result.rejected} rejected`);
    if (result.errors.length > 0) {
      console.log("Rejections:");
      for (const e of result.errors) {
        console.log(`  [${e.index}] ${e.message}`);
      }
    }
    for (const run of result.runs) {
      console.log(
        `  cm=${run.challengeModeId} +${run.keystoneLevel} ${run.onTime ? "timed" : "depleted"} +${run.upgrades} deaths=${run.deaths} members=${run.members.length}`,
      );
    }
  } catch (err) {
    console.error("❌ Parse failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function cmdWatch(path: string): Promise<void> {
  const client = makeApiClient();
  const cfg = loadConfig();
  if (!cfg.jwt) {
    console.error("❌ Not paired. Run `pair <code>` first.");
    process.exit(1);
  }

  console.log(`👀 Watching ${path}`);
  console.log(`   API: ${cfg.apiBaseUrl}`);
  console.log(`   Already posted: ${cfg.postedRunHashes.length} run(s)`);
  console.log("   (ctrl+c to stop)");

  updateConfig({ savedVariablesPath: path });

  const queue = new RunQueue(client);
  const watcher = new SavedVariablesWatcher(path, 500);

  watcher.on("ready", () => {
    console.log("   watcher ready — processing any pending runs from previous session…");
    void processAndLog(queue, path);
  });
  watcher.on("updated", () => {
    void processAndLog(queue, path);
  });
  watcher.on("error", (err) => {
    console.error("   watcher error:", err.message);
  });

  watcher.start();

  process.on("SIGINT", () => {
    console.log("\nStopping…");
    void watcher.stop().then(() => process.exit(0));
  });
}

async function processAndLog(queue: RunQueue, path: string): Promise<void> {
  try {
    const result = await queue.processSavedVariables(path);
    if (result.newRuns === 0 && result.errors.length === 0) return;
    console.log(
      `   tick: new=${result.newRuns} submitted=${result.submitted} dedup=${result.deduplicated} skipped=${result.skipped} errors=${result.errors.length}`,
    );
  } catch (err) {
    console.error("   tick error:", err instanceof Error ? err.message : String(err));
  }
}

function cmdConfig(): void {
  const cfg = loadConfig();
  console.log(`Companion config (${configPath()}):`);
  console.log(JSON.stringify(
    {
      ...cfg,
      jwt: cfg.jwt ? `<${cfg.jwt.length} chars>` : null,
      postedRunHashes: `<${cfg.postedRunHashes.length} hashes>`,
    },
    null,
    2,
  ));
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);

  switch (subcommand) {
    case "pair": {
      const code = rest[0];
      if (!code) {
        console.error("Usage: pair <6-digit-code>");
        process.exit(2);
      }
      await cmdPair(code);
      return;
    }
    case "parse": {
      const path = rest[0];
      if (!path) {
        console.error("Usage: parse <path-to-SavedVariables/MKeyTracker.lua>");
        process.exit(2);
      }
      await cmdParse(path);
      return;
    }
    case "watch": {
      const path = rest[0];
      if (!path) {
        console.error("Usage: watch <path-to-SavedVariables/MKeyTracker.lua>");
        process.exit(2);
      }
      await cmdWatch(path);
      return;
    }
    case "config":
      cmdConfig();
      return;
    default:
      console.error("Usage: companion <pair|parse|watch|config> [args]");
      process.exit(2);
  }
}

void main();
