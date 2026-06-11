// A deterministic string key for an arbitrary value, for sorting and dedupe.
// Object keys are recursively sorted before stringifying so that two values with
// the same content but different key order collapse to the same key. The WeakSet
// guards against cycles so a self-referential structure can't blow the stack.
//
// Both the linter (lint dedupe keys) and the normalizer (canonical selector-arm
// ordering) key on this, and those two have to agree byte-for-byte — keep them
// reading the one implementation here.
export function stableKey(x: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);

    if (Array.isArray(v)) return (v as unknown[]).map(stringify);

    const keys = Object.keys(v).sort();
    const result: Record<string, unknown> = {};
    for (const k of keys)
      result[k] = stringify((v as Record<string, unknown>)[k]);
    return result;
  };
  return JSON.stringify(stringify(x));
}
