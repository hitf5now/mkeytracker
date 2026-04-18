/**
 * Splits a WoW combat-log event body into comma-separated tokens while
 * respecting quoted strings, bracketed arrays, and parenthesized tuples.
 *
 * Input is the portion of a log line AFTER the timestamp block — i.e. starting
 * with the event type. Example:
 *
 *   SPELL_DAMAGE,Player-1,"Foo, Bar",0x511,...
 *
 * Top-level commas separate tokens; commas inside "...", [...], or (...) do not.
 * Nested [...] / (...) to any depth are handled.
 */
export function tokenize(body: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let depth = 0;
  let inQuote = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (inQuote) {
      if (ch === '"') inQuote = false;
      continue;
    }

    switch (ch) {
      case '"':
        inQuote = true;
        break;
      case '[':
      case '(':
        depth++;
        break;
      case ']':
      case ')':
        depth--;
        break;
      case ',':
        if (depth === 0) {
          tokens.push(body.slice(start, i));
          start = i + 1;
        }
        break;
    }
  }

  tokens.push(body.slice(start));
  return tokens;
}

/** Strip one layer of surrounding double-quotes if present. */
export function unquote(token: string | undefined): string {
  if (!token) return '';
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  return token;
}

/** Parse a token as number. `"nil"`, empty, undefined, and unparseable → 0. */
export function toNumber(token: string | undefined): number {
  if (!token || token === 'nil') return 0;
  const n = Number(token);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a token as boolean. WoW uses 1/0/nil, and occasionally `true`/`false`. */
export function toBool(token: string | undefined): boolean {
  return token === '1' || token === 'true';
}
