// Stable stringify to prevent recursion explosion */
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
