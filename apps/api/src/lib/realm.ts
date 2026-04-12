/**
 * Realm slug normalization.
 *
 * WoW realm names come in multiple forms depending on source:
 *   - In-game `GetRealmName()` → "Area 52", "Moon Guard"
 *   - RaiderIO profile.realm field → "Trollbane", "Area 52" (display form)
 *   - RaiderIO URL path slug → "area-52", "moon-guard"
 *   - User input in /register → anything
 *
 * The canonical form used throughout our database is the slug:
 * lowercase, ASCII-only, apostrophes stripped, spaces/underscores → dashes.
 * This matches the convention used in RaiderIO's own profile URLs.
 *
 * All character lookups (region, realm, name) must pass realm through
 * this normalizer before hitting the DB so the unique constraint works.
 */

/** Convert any variant of a realm name to the canonical slug. */
export function toRealmSlug(realm: string): string {
  return realm
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['\u2019]/g, "") // drop apostrophes (Aman'Thul → amanthul)
    .replace(/[\s_]+/g, "-") // spaces & underscores → dash
    .replace(/[^a-z0-9-]/g, "") // strip anything else
    .replace(/-+/g, "-") // collapse multiple dashes
    .replace(/^-|-$/g, ""); // trim leading/trailing dashes
}
