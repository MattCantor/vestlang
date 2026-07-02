/** Total absolute share disagreement between two projections, bucketed by date.
 * Zero iff they vest the same amounts on exactly the same dates.
 *
 * Part of the inferrer's public surface: `@vestlang/recover` imports it to
 * independently re-assert that a rescued template reproduces the original
 * projection exactly (it demands 0), the license for flipping an events-only
 * verdict to template. Kept in its own tiny module — the search machinery that
 * used to host it (residual.ts / verify.ts) is gone. */
export function projectionResidual(
  a: Iterable<{ date: string; amount: number }>,
  b: Iterable<{ date: string; amount: number }>,
): number {
  const byDate = new Map<string, number>();
  for (const { date, amount } of a)
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  for (const { date, amount } of b)
    byDate.set(date, (byDate.get(date) ?? 0) - amount);
  let residual = 0;
  for (const delta of byDate.values()) residual += Math.abs(delta);
  return residual;
}
