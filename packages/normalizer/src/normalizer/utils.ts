import {
  Condition,
  RawScheduleExpr,
  Schedule,
  ScheduleExpr,
  VestingNode,
  VestingNodeExpr,
} from "@vestlang/types";
import type { SourceLocation } from "@vestlang/types";

/**
 * Create a deterministic key for sorting/deduplication.
 */
function stableKey(x: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return (v as unknown[]).map(stringify);
    const keys = Object.keys(v).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = stringify((v as Record<string, unknown>)[k]);
    return out;
  };
  return JSON.stringify(stringify(x));
}

/** Remove structural duplicates while preserving the first occurrence. */
function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = stableKey(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

/**
 * Something the normalizer notices while canonicalizing that the output no longer
 * shows — so only the normalizer is positioned to catch it. Keyed on `kind` (the
 * house style, cf. `Finding` in @vestlang/types): each variant carries just the
 * data its diagnostic needs, and `normalizeProgram` maps it to a `Diagnostic`,
 * stamping the statement path. `lintText` surfaces them.
 *
 *   duplicate-selector — dedupe dropped a repeated selector arm.
 *   mixed-boolean      — a bare `a OR b AND c` whose grouping the precedence rule
 *                        resolved silently (the `no-implicit-mixed-boolean` nudge).
 *
 * The path is added by the per-statement closure, not here, so variants stay
 * about the finding itself.
 */
export type NormalizationFinding =
  | { kind: "duplicate-selector"; selectorType: string }
  | { kind: "mixed-boolean"; loc: SourceLocation };

export type FindingSink = (finding: NormalizationFinding) => void;

/**
 * Normalize an expression
 * - Recursively normalizes items
 * - Flattens nested same-op selectors
 * - Sorts and dedupes same-op selectors
 */
export function NormalizeAndSort<
  T extends RawScheduleExpr,
  E extends { type: string; items: T[] },
  N extends ScheduleExpr,
>(expression: E, normalizeFN: (x: T) => N, report?: FindingSink): N;
export function NormalizeAndSort<
  T extends VestingNodeExpr,
  E extends { type: string; items: T[] },
  N extends VestingNodeExpr,
>(expression: E, normalizeFN: (x: T) => N, report?: FindingSink): N;
export function NormalizeAndSort<
  T extends Condition,
  E extends { type: string; items: T[] },
  N extends Condition,
>(expression: E, normalizeFN: (x: T) => N, report?: FindingSink): N;
export function NormalizeAndSort<
  T extends Schedule | VestingNode | Condition,
  E extends { type: string; items: T[] },
  N extends Schedule | VestingNode | Condition,
>(expression: E, normalizeFN: (x: T) => N, report?: FindingSink) {
  // Normalize children (nested selectors or vesting nodes or schedules
  let items = expression.items.map(normalizeFN);

  // Flatten same-op: EARLIER OF ( EARLIER OF (...), x ) -> EARLIER OF (...)
  items = items.flatMap((item) =>
    item.type === expression.type
      ? (item as unknown as { items: N[] }).items
      : [item],
  );

  // Sort & dedupe
  items.sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
  const beforeDedupe = items.length;
  items = dedupe(items);
  if (report && items.length < beforeDedupe)
    report({ kind: "duplicate-selector", selectorType: expression.type });

  // Collapse singletons
  if (items.length === 1) return items[0];

  if (items.length === 0) {
    throw new Error(`${expression.type} became empty after normalization`);
  }

  return { ...expression, items };
}
