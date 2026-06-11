/** Total absolute share disagreement between two projections, bucketed by date.
 * Zero iff they vest the same amounts on exactly the same dates. Both the
 * inferrer's fit check and recover's rescue gate hinge on this number meaning the
 * same thing, so they share one implementation — though they read it against
 * different thresholds (the inferrer tolerates EPSILON, recover demands exactly 0). */
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
