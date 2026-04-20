/**
 * One-off audit: for every damage event inside a CHALLENGE_MODE segment,
 * read the advanced-logging `ownerGUID` field (position depends on event
 * variant) and report:
 *
 *   - how many damage events from non-Player sources carry a Player ownerGUID
 *   - which (sourceGUID, sourceName) pairs would have been ORPHANED without
 *     the ownerGUID fallback (i.e. never seen as dest of SPELL_SUMMON)
 *   - total damage-done that would be gained by using ownerGUID as a
 *     secondary lookup
 *
 * Uses the real tokenizer from @mplus/combat-log-parser to avoid awk's
 * comma-in-quoted-name pitfalls.
 *
 * Run:  node scripts/audit-owner-guid.mjs <path-to-log>
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { tokenize, unquote } from '../packages/combat-log-parser/dist/tokenizer.js';

const DAMAGE_EVENTS = new Set([
  'SPELL_DAMAGE',
  'SPELL_PERIODIC_DAMAGE',
  'RANGE_DAMAGE',
  'SWING_DAMAGE',
  'SPELL_DAMAGE_SUPPORT',
]);

/**
 * Advanced-logging block (17 fields) sits immediately after the spell-info
 * portion of the event. For SWING_DAMAGE there is no spell info; for the
 * *_DAMAGE events the spell info is [spellId, spellName, spellSchool].
 *
 * So after the 8-token prefix:
 *   SWING_DAMAGE:          infoGUID at index 9,  ownerGUID at 10
 *   SPELL_*_DAMAGE:        infoGUID at index 12, ownerGUID at 13
 */
function ownerGuidIndexFor(eventType) {
  if (eventType === 'SWING_DAMAGE') return 10;
  return 13;
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('usage: audit-owner-guid.mjs <log>');

  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let inSegment = false;
  let lineNo = 0;
  let damageSeen = 0;

  // Pet mapping from SPELL_SUMMON (mirrors aggregator logic exactly)
  const summonOwners = new Map(); // petGUID -> playerGUID

  // ownerGUID-derived mapping
  const ownerGuidMap = new Map(); // petGUID -> playerGUID (from advanced logging)

  // Per-source totals (by name for readability)
  const perSourceName = new Map(); // name -> { guidSet, events, damageSum, hasSummon, hasOwnerGuid }

  for await (const rawLine of rl) {
    lineNo++;
    const sep = rawLine.indexOf('  ');
    if (sep < 0) continue;
    const body = rawLine.slice(sep + 2);

    // Cheap prefilter before tokenizing
    const comma = body.indexOf(',');
    if (comma < 0) continue;
    const eventType = body.slice(0, comma);

    if (eventType === 'CHALLENGE_MODE_START') {
      inSegment = true;
      continue;
    }
    if (eventType === 'CHALLENGE_MODE_END') {
      // Only close on a real end (non-zero durationMs)
      const t = tokenize(body);
      const durMs = Number(t[4] ?? '0');
      if (durMs > 0) break;
      inSegment = false;
      continue;
    }

    if (!inSegment) continue;

    if (eventType === 'SPELL_SUMMON') {
      const t = tokenize(body);
      const srcGuid = t[1] ?? '';
      const destGuid = t[5] ?? '';
      if (srcGuid.startsWith('Player-') && destGuid) {
        summonOwners.set(destGuid, srcGuid);
      }
      continue;
    }

    if (!DAMAGE_EVENTS.has(eventType)) continue;

    const t = tokenize(body);
    const srcGuid = t[1] ?? '';
    const srcName = unquote(t[2] ?? '');
    if (!srcGuid || srcGuid.startsWith('Player-')) continue; // we only care about non-player sources

    damageSeen++;
    const ownerIdx = ownerGuidIndexFor(eventType);
    const ownerGuid = t[ownerIdx] ?? '';
    const amount = readAmount(t, eventType);

    if (ownerGuid.startsWith('Player-')) {
      ownerGuidMap.set(srcGuid, ownerGuid);
    }

    let rec = perSourceName.get(srcName);
    if (!rec) {
      rec = {
        guidSet: new Set(),
        events: 0,
        damageSum: 0,
        ownerGuidEvents: 0,
        ownerGuidDamage: 0,
      };
      perSourceName.set(srcName, rec);
    }
    rec.guidSet.add(srcGuid);
    rec.events++;
    rec.damageSum += amount;
    if (ownerGuid.startsWith('Player-')) {
      rec.ownerGuidEvents++;
      rec.ownerGuidDamage += amount;
    }
  }

  // ---------- Report ----------

  console.log(`== ${path} ==`);
  console.log(`damage events from non-Player sources: ${damageSeen}`);
  console.log(`unique guardians mapped via SPELL_SUMMON: ${summonOwners.size}`);
  console.log(`unique non-Player sources with Player ownerGUID in advanced logging: ${ownerGuidMap.size}`);

  // ORPHAN analysis: sources with Player ownerGUID but NOT in summonOwners
  let orphanGuids = 0;
  let orphanEvents = 0;
  let orphanDamage = 0;
  const orphanByName = new Map();

  for (const [guid, owner] of ownerGuidMap) {
    if (summonOwners.has(guid)) continue;
    orphanGuids++;
    // find per-event counts by re-walking perSourceName? easier: scan map for this guid
    // We didn't keep per-GUID stats, so we approximate by noting the name.
  }

  // Re-scan perSourceName to split summoned vs orphan per name
  console.log(
    '\nPer source-name: (orphan = has Player ownerGUID in damage event but no SPELL_SUMMON record)',
  );
  console.log(
    'name'.padEnd(30) +
      '  ' +
      'events'.padStart(8) +
      '  ' +
      'damage'.padStart(14) +
      '  ' +
      'ownerEv'.padStart(8) +
      '  ' +
      'ownerDmg'.padStart(14) +
      '  ' +
      'uGUIDs'.padStart(7) +
      '  ' +
      'summ'.padStart(6) +
      '  ' +
      'orph'.padStart(6),
  );
  const rows = Array.from(perSourceName.entries()).map(([name, r]) => {
    let summoned = 0;
    let orphan = 0;
    for (const g of r.guidSet) {
      if (summonOwners.has(g)) summoned++;
      else if (ownerGuidMap.has(g)) orphan++;
    }
    return { name, r, summoned, orphan };
  });
  rows.sort((a, b) => b.r.damageSum - a.r.damageSum);
  for (const row of rows.slice(0, 25)) {
    const { name, r, summoned, orphan } = row;
    console.log(
      name.slice(0, 30).padEnd(30) +
        '  ' +
        String(r.events).padStart(8) +
        '  ' +
        r.damageSum.toLocaleString().padStart(14) +
        '  ' +
        String(r.ownerGuidEvents).padStart(8) +
        '  ' +
        r.ownerGuidDamage.toLocaleString().padStart(14) +
        '  ' +
        String(r.guidSet.size).padStart(7) +
        '  ' +
        String(summoned).padStart(6) +
        '  ' +
        String(orphan).padStart(6),
    );
  }

  // Aggregate orphan damage (ownerGUID non-zero but no SPELL_SUMMON)
  let totalOrphanEvents = 0;
  let totalOrphanDamage = 0;
  for (const [guid, owner] of ownerGuidMap) {
    if (summonOwners.has(guid)) continue;
    // We need per-GUID damage; re-walk source-name records?
    // Simpler: re-read the log once more — but for brevity, approximate below.
  }
  // Rough estimate: sum ownerGuidDamage for rows whose guidSet is fully outside summonOwners
  for (const { r, summoned, orphan } of rows) {
    if (summoned === 0 && orphan > 0) {
      totalOrphanEvents += r.ownerGuidEvents;
      totalOrphanDamage += r.ownerGuidDamage;
    }
  }
  console.log(
    `\nFULLY-ORPHAN source NAMES (zero SPELL_SUMMON across all their GUIDs, but have Player ownerGUID):`,
  );
  console.log(`  events: ${totalOrphanEvents}`);
  console.log(`  damage gained by using ownerGUID fallback: ${totalOrphanDamage.toLocaleString()}`);
}

function readAmount(tokens, eventType) {
  // Mirror parser.ts suffix detection:
  const COMBAT_TAGS = new Set(['ST', 'AOE', 'NONE', 'HOT', 'DOT']);
  const last = tokens[tokens.length - 1] ?? '';
  const isSupport = eventType === 'SPELL_DAMAGE_SUPPORT';
  const isGuid =
    last.startsWith('Player-') || last.startsWith('Creature-') || last.startsWith('Pet-');
  const hasTrailer = isSupport || COMBAT_TAGS.has(last) || isGuid;
  const suffixLen = hasTrailer ? 11 : 10;
  if (tokens.length < suffixLen) return 0;
  const base = tokens.length - suffixLen;
  const n = Number(tokens[base]);
  return Number.isFinite(n) ? n : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
