// Stable stringify to prevent recursion explosion */
export function stableKey(x: unknown): string {
  const seen = new WeakSet<object>();
  const stringify = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);

    if (Array.isArray(v)) return v.map(stringify);

    const keys = Object.keys(v).sort();
    const result: Record<string, any> = {};
    for (const k of keys) result[k] = stringify(v[k]);
    return result;
  };
  return JSON.stringify(stringify(x));
}

export function at<T>(arr: T[], i: number): T | undefined {
  return i >= 0 && i < arr.length ? arr[i] : undefined;
}
