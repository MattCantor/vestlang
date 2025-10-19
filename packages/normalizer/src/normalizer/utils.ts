import {
  Condition,
  RawScheduleExpr,
  Schedule,
  ScheduleExpr,
  VestingNode,
  VestingNodeExpr,
} from "@vestlang/types";

/**
 * Create a deterministic key for sorting/deduplication.
 */
function stableKey(x: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(stringify);
    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = stringify(v[k]);
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
 * Normalize an expression
 * - Recursively normalizes items
 * - Flattens nested same-op selectors
 * - Sorts and dedupes same-op selectors
 */
export function NormalizeAndSort<
  T extends RawScheduleExpr,
  E extends { type: string; items: T[] },
  N extends ScheduleExpr,
>(expression: E, normalizeFN: (x: T) => N): N;
export function NormalizeAndSort<
  T extends VestingNodeExpr,
  E extends { type: string; items: T[] },
  N extends VestingNodeExpr,
>(expression: E, normalizeFN: (x: T) => N): N;
export function NormalizeAndSort<
  T extends Condition,
  E extends { type: string; items: T[] },
  N extends Condition,
>(expression: E, normalizeFN: (x: T) => N): N;
export function NormalizeAndSort<
  T extends Schedule | VestingNode | Condition,
  E extends { type: string; items: T[] },
  N extends Schedule | VestingNode | Condition,
>(expression: E, normalizeFN: (x: T) => N) {
  // Normalize children (nested selectors or vesting nodes or schedules
  let items = expression.items.map(normalizeFN);

  // Flatten same-op: EARLIER_OF(EARLIER_OF(...), x) -> EARLIER_OF(...)
  items = items.flatMap((item) =>
    item.type === expression.type ? (item as any).items : [item],
  );

  // Sort & dedupe
  items.sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
  items = dedupe(items);

  // Collapse singletons
  if (items.length === 1) return items[0];

  if (items.length === 0) {
    throw new Error(`${expression.type} became empty after normalization`);
  }

  return { ...expression, items };
}
