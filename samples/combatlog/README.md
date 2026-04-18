# Combat Log Samples

Drop `WoWCombatLog.txt` files here for parser development and fixtures.

**Source path on Windows:**
```
C:\Program Files (x86)\World of Warcraft\_retail_\Logs\WoWCombatLog.txt
```

**Naming convention:** `YYYY-MM-DD_<scenario>.txt`
Examples:
- `2026-04-18_dummy-30s.txt` — training dummy for format inspection
- `2026-04-18_mplus-mists-11.txt` — full M+ run
- `2026-04-18_dungeon-heroic.txt` — non-keyed dungeon

**Privacy note:** logs contain GUIDs and character names of all nearby players. Only commit samples from your own groups; scrub or redact if unsure.

See `docs/COMBAT_LOG_RESEARCH.md` for format details and the full capture workflow.
