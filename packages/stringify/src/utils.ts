/**
 * Format a keyword (uppercase).
 */
export function kw(keyword: string): string {
  return keyword.toUpperCase();
}

/**
 * Format a parenthesized group like "LATER OF(a, b)".
 */
export function parenGroup(keyword: string, items: string[]): string {
  return `${keyword}(${items.join(", ")})`;
}

/**
 * Lowercase the PeriodTag ("MONTHS" / "DAYS") and depluralize when the
 * count is exactly 1 — so "1 month" / "1 day" instead of "1 months" /
 * "1 days". Negative values are treated by magnitude.
 */
export function unitFor(count: number, type: "MONTHS" | "DAYS"): string {
  const lower = type.toLowerCase();
  return Math.abs(count) === 1 ? lower.slice(0, -1) : lower;
}
