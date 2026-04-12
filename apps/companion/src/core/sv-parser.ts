/**
 * Parser for WoW SavedVariables files.
 *
 * WoW writes SavedVariables as plain Lua source code that assigns to a
 * global variable. For our addon it looks like:
 *
 *   MKeyTrackerDB = {
 *     ["pendingRuns"] = {
 *       {
 *         ["challengeModeId"] = 239,
 *         ["keystoneLevel"] = 15,
 *         ["members"] = {
 *           { ["name"] = "Tanavast", ["realm"] = "trollbane", ... },
 *           ...
 *         },
 *         ...
 *       },
 *       ...
 *     },
 *     ["lastCapturedHash"] = "abc123",
 *   }
 *
 * We parse the file with luaparse (a pure-JS Lua 5.1 parser), walk the
 * AST of the top-level assignment, and convert Lua table constructors
 * into plain JS objects/arrays. Then we pick out `pendingRuns` and
 * validate each entry against a zod schema matching RunSubmission.
 */

import { readFileSync } from "node:fs";
import * as luaparse from "luaparse";
import type {
  Chunk,
  Expression,
  Field,
  NumericLiteral,
  TableConstructorExpression,
  UnaryExpression,
} from "luaparse";
import { z } from "zod";

// ─── Zod schema matching RunSubmission ────────────────────────────────────
// Intentionally duplicated from the API's runs route: we want the companion
// to fail fast on malformed addon output rather than ship garbage upstream.

const MemberSchema = z.object({
  name: z.string().min(2),
  realm: z.string().min(1),
  class: z.string(),
  spec: z.string(),
  role: z.enum(["tank", "healer", "dps"]),
});

const RunSubmissionSchema = z.object({
  challengeModeId: z.number().int(),
  keystoneLevel: z.number().int().min(2),
  completionMs: z.number().int().nonnegative(),
  onTime: z.boolean(),
  upgrades: z.number().int().min(0).max(3),
  deaths: z.number().int().nonnegative(),
  timeLostSec: z.number().int().nonnegative().default(0),
  serverTime: z.number().int().positive(),
  affixes: z.array(z.number().int()).default([]),
  region: z.enum(["us", "eu", "kr", "tw", "cn"]),
  members: z.array(MemberSchema).length(5),
  source: z.enum(["addon", "manual", "raiderio"]).default("addon"),
  eventId: z.number().int().positive().optional(),
});

export type ParsedRun = z.infer<typeof RunSubmissionSchema>;

export interface ParseResult {
  /** Runs that passed schema validation and are ready to POST. */
  runs: ParsedRun[];
  /** Count of entries in pendingRuns[] that failed schema validation. */
  rejected: number;
  /** Errors from rejected entries, index-aligned to the SV array position. */
  errors: Array<{ index: number; message: string }>;
  /** Any other top-level values we recognized (lastCapturedHash, etc.) */
  lastCapturedHash: string | null;
}

// ─── Lua AST → JS value conversion ────────────────────────────────────────

type LuaValue = string | number | boolean | null | LuaValue[] | { [key: string]: LuaValue };

function luaNumberValue(node: NumericLiteral | UnaryExpression): number {
  if (node.type === "NumericLiteral") return node.value;
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const inner = luaToJs(node.argument);
    if (typeof inner === "number") return -inner;
  }
  throw new Error(`Unsupported numeric expression: ${node.type}`);
}

function luaToJs(node: Expression): LuaValue {
  switch (node.type) {
    case "StringLiteral":
      return (node as { value: string }).value;
    case "NumericLiteral":
      return (node as NumericLiteral).value;
    case "BooleanLiteral":
      return (node as { value: boolean }).value;
    case "NilLiteral":
      return null;
    case "UnaryExpression":
      return luaNumberValue(node as UnaryExpression);
    case "TableConstructorExpression":
      return tableToJs(node as TableConstructorExpression);
    default:
      throw new Error(`Unsupported Lua expression type: ${node.type}`);
  }
}

/**
 * Convert a Lua table constructor to either a JS array or a JS object.
 *
 * Lua tables can be mixed: they have array-like entries (TableValue) and
 * keyed entries (TableKey, TableKeyString). If every field is a TableValue
 * we emit an array. Otherwise we emit an object and numeric array indices
 * become object keys (matching luaparse's model).
 */
function tableToJs(node: TableConstructorExpression): LuaValue {
  const allValues = node.fields.every((f: Field) => f.type === "TableValue");
  if (allValues && node.fields.length > 0) {
    return node.fields.map((f) => {
      const val = (f as { value: Expression }).value;
      return luaToJs(val);
    });
  }

  // Empty table — we don't know if it was meant as [] or {}. Treat as [].
  if (node.fields.length === 0) return [];

  const obj: { [key: string]: LuaValue } = {};
  for (const field of node.fields) {
    if (field.type === "TableKeyString") {
      obj[field.key.name] = luaToJs(field.value);
    } else if (field.type === "TableKey") {
      // Computed key — usually a string literal like ["foo"]
      const key = luaToJs(field.key);
      if (typeof key !== "string" && typeof key !== "number") {
        throw new Error(`Non-primitive table key: ${typeof key}`);
      }
      obj[String(key)] = luaToJs(field.value);
    } else if (field.type === "TableValue") {
      // Mixed table — ignore array part for now; could be extended
      // if we ever have WoW data that uses this pattern.
    }
  }
  return obj;
}

// ─── Top-level extract ────────────────────────────────────────────────────

/**
 * Finds the first top-level assignment matching `varName = { ... }`
 * and returns it as a JS object.
 */
function findGlobalAssignment(chunk: Chunk, varName: string): LuaValue | null {
  for (const stmt of chunk.body) {
    if (stmt.type !== "AssignmentStatement") continue;
    const a = stmt as {
      variables: Expression[];
      init: Expression[];
    };
    // Look for single-target assignments of form  IDENT = <expr>
    for (let i = 0; i < a.variables.length; i++) {
      const target = a.variables[i];
      if (target && target.type === "Identifier" && (target as { name: string }).name === varName) {
        const value = a.init[i];
        if (!value) return null;
        return luaToJs(value);
      }
    }
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Parse a SavedVariables file from disk and extract the MKeyTracker data.
 *
 * @param filePath Absolute path to the .lua file
 * @returns Parsed and validated pending runs, plus rejection diagnostics
 */
export function parseSavedVariablesFile(filePath: string): ParseResult {
  const source = readFileSync(filePath, "utf-8");
  return parseSavedVariablesSource(source);
}

/**
 * Parse SavedVariables Lua source directly. Exposed for unit tests and for
 * the watcher which already has the file contents in memory.
 */
export function parseSavedVariablesSource(source: string): ParseResult {
  let chunk: Chunk;
  try {
    // encodingMode must be non-default so StringLiteral nodes get a `value`
    // populated. Without this, luaparse leaves `value: null` and we have to
    // strip quotes from `raw` manually. pseudo-latin1 is safe for ASCII +
    // Latin-1 which covers all WoW addon output.
    chunk = luaparse.parse(source, {
      luaVersion: "5.1",
      comments: false,
      encodingMode: "pseudo-latin1",
    });
  } catch (err) {
    throw new Error(
      `Lua parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const db = findGlobalAssignment(chunk, "MKeyTrackerDB");
  if (db === null) {
    return { runs: [], rejected: 0, errors: [], lastCapturedHash: null };
  }
  if (typeof db !== "object" || Array.isArray(db)) {
    throw new Error("MKeyTrackerDB is not a table");
  }

  const pending = (db as Record<string, LuaValue>)["pendingRuns"];
  const lastHash = (db as Record<string, LuaValue>)["lastCapturedHash"];
  const lastCapturedHash =
    typeof lastHash === "string" ? lastHash : null;

  const runs: ParsedRun[] = [];
  const errors: Array<{ index: number; message: string }> = [];
  let rejected = 0;

  if (Array.isArray(pending)) {
    for (let i = 0; i < pending.length; i++) {
      const parsed = RunSubmissionSchema.safeParse(pending[i]);
      if (parsed.success) {
        runs.push(parsed.data);
      } else {
        rejected++;
        errors.push({
          index: i,
          message: parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        });
      }
    }
  }

  return { runs, rejected, errors, lastCapturedHash };
}
