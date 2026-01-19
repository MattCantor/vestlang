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
