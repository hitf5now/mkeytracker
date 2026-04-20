/**
 * One-off: run the parser against every segment in a log file and print
 * per-player damageDone / damageDoneSupport / healingDoneSupport for the
 * Augmentation Evoker (Makye-Azralon-US in log 1 / Maisara Caverns).
 */
import { summarizeAllSegmentsInLogFile } from '../packages/combat-log-parser/dist/index.js';

const path = process.argv[2];
if (!path) throw new Error('usage: verify-makye.mjs <log>');

const segments = await summarizeAllSegmentsInLogFile(path);
console.log(`Found ${segments.length} completed segment(s).`);

for (const s of segments) {
  console.log(`\n== ${s.zoneName} +${s.keystoneLevel}  (${s.players.length} players) ==`);
  console.log(
    '  ' +
      'Name'.padEnd(30) +
      'Damage'.padStart(14) +
      'Pet'.padStart(14) +
      'SupDmg'.padStart(14) +
      'Healing'.padStart(14) +
      'SupHeal'.padStart(14),
  );
  for (const p of s.players) {
    console.log(
      '  ' +
        (p.name || p.guid).slice(0, 29).padEnd(30) +
        p.damageDone.toLocaleString().padStart(14) +
        p.petDamageDone.toLocaleString().padStart(14) +
        p.damageDoneSupport.toLocaleString().padStart(14) +
        p.healingDone.toLocaleString().padStart(14) +
        p.healingDoneSupport.toLocaleString().padStart(14),
    );
  }
  console.log(`  raid totals: dmg=${s.totals.damage.toLocaleString()}  pet=${s.totals.petDamage.toLocaleString()}  supDmg=${s.totals.damageSupport.toLocaleString()}  supHeal=${s.totals.healingSupport.toLocaleString()}`);
}
