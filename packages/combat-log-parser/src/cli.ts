#!/usr/bin/env node
import { summarizeLogFile } from './stream.js';
import type { RunSummary } from './types.js';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: mplus-parse-log <path-to-WoWCombatLog.txt>');
    process.exit(1);
  }

  const started = Date.now();
  console.error(`Reading ${filePath}...`);

  const summary = await summarizeLogFile(filePath, {
    onProgress: (lines) => {
      process.stderr.write(`\r  lines processed: ${lines.toLocaleString()}`);
    },
  });
  process.stderr.write('\n');

  if (!summary) {
    console.error('No complete Challenge Mode segment found in file.');
    process.exit(2);
  }

  const elapsedMs = Date.now() - started;
  console.error(`Parsed in ${elapsedMs} ms.\n`);

  printHumanSummary(summary);

  if (process.argv.includes('--json')) {
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(summary, null, 2));
  }
}

function printHumanSummary(s: RunSummary): void {
  const mmss = (ms: number): string => {
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  console.log(`=== ${s.zoneName} +${s.keystoneLevel} ===`);
  console.log(
    `${s.success ? 'TIMED' : 'DEPLETED'}  ${mmss(s.durationMs)}  ` +
      `affixes=[${s.affixIds.join(',')}]  challengeModeId=${s.challengeModeId}`,
  );
  if (s.endingTrailingFields.length > 0) {
    console.log(
      `trailing fields on CHALLENGE_MODE_END: [${s.endingTrailingFields.join(', ')}]`,
    );
  }
  console.log(
    `started=${s.startedAt.toISOString()}  ended=${s.endedAt.toISOString()}\n`,
  );

  console.log('Encounters:');
  if (s.encounters.length === 0) {
    console.log('  (none)');
  } else {
    for (const e of s.encounters) {
      const outcome = e.success ? '✓ kill' : '✗ wipe';
      console.log(
        `  ${outcome}  ${e.encounterName.padEnd(24)}  ${mmss(e.fightTimeMs)}`,
      );
    }
  }

  console.log('\nPlayers (sorted by damage done):');
  const header =
    '  Name'.padEnd(28) +
    'Spec'.padEnd(6) +
    'Damage'.padStart(14) +
    '  of which Pet'.padStart(16) +
    'Supp Dmg'.padStart(14) +
    'Healing'.padStart(14) +
    'Intr'.padStart(6) +
    'Disp'.padStart(6) +
    'Deaths'.padStart(8);
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));

  for (const p of s.players) {
    const shortName = (p.name || p.guid).slice(0, 25);
    console.log(
      '  ' +
        shortName.padEnd(26) +
        String(p.specId ?? '—').padEnd(6) +
        p.damageDone.toLocaleString().padStart(14) +
        (p.petDamageDone > 0 ? p.petDamageDone.toLocaleString() : '—').padStart(16) +
        p.damageDoneSupport.toLocaleString().padStart(14) +
        p.healingDone.toLocaleString().padStart(14) +
        String(p.interrupts).padStart(6) +
        String(p.dispels).padStart(6) +
        String(p.deaths).padStart(8),
    );
  }

  console.log('\nRun totals:');
  console.log(`  damage:        ${s.totals.damage.toLocaleString()}`);
  console.log(`    of which pet:${s.totals.petDamage.toLocaleString().padStart(15)}`);
  console.log(`  support dmg:   ${s.totals.damageSupport.toLocaleString()}`);
  console.log(`  healing:       ${s.totals.healing.toLocaleString()}`);
  console.log(`    of which pet:${s.totals.petHealing.toLocaleString().padStart(15)}`);
  console.log(`  support heal:  ${s.totals.healingSupport.toLocaleString()}`);
  console.log(`  interrupts:    ${s.totals.interrupts}`);
  console.log(`  dispels:       ${s.totals.dispels}`);
  console.log(`  party deaths:  ${s.totals.deaths}`);

  const dps = s.durationMs > 0 ? s.totals.damage / (s.durationMs / 1000) : 0;
  const hps = s.durationMs > 0 ? s.totals.healing / (s.durationMs / 1000) : 0;
  console.log(`  raid DPS:      ${Math.round(dps).toLocaleString()}`);
  console.log(`  raid HPS:      ${Math.round(hps).toLocaleString()}`);

  const topEvents = Object.entries(s.eventCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log('\nTop event types observed:');
  for (const [ev, n] of topEvents) {
    console.log(`  ${ev.padEnd(30)} ${n.toLocaleString()}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
