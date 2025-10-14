/**
 * Create a deterministic key for sorting/deduplication.
 */
export function stableKey(x: unknown): string {
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
export function dedupe<T>(arr: T[]): T[] {
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
