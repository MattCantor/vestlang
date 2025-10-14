import { Duration, OffsetTag, PeriodTag } from "@vestlang/dsl";

/** Construct a canonical Duration. */
function makeDuration(
  value: number,
  unit: PeriodTag,
  sign: OffsetTag,
): Duration {
  return {
    type: "DURATION",
    value,
    unit,
    sign,
  } as Duration;
}

/* ------------------------
 * Offsets
 * ------------------------ */

/**
 * Canonicalize offsets:
 *  - sum MONTHS separately from DAYS
 *  - represent with explicit sign and value >= 0
 *  - drop zeros
 *
 *  @example
 *    [+2M, -1M, +10D] -> [+1M, +10D]
 */
export function normalizeOffsets(offsets: Duration[]): Duration[] {
  if (!offsets || offsets.length === 0) return [];

  let months = 0;
  let days = 0;

  for (const o of offsets) {
    const unsigned = Math.abs(o.value);
    const signed = o.sign === "MINUS" ? -unsigned : unsigned;
    if (o.unit === "MONTHS") months += signed;
    else if (o.unit === "DAYS") days += signed;
    else throw new Error(`normalizeOffsets: Unexpected unit: ${o.unit}`);
  }

  const out: Duration[] = [];
  if (months !== 0)
    out.push(
      makeDuration(Math.abs(months), "MONTHS", months < 0 ? "MINUS" : "PLUS"),
    );
  if (days !== 0)
    out.push(makeDuration(Math.abs(days), "DAYS", days < 0 ? "MINUS" : "PLUS"));
  return out;
}
