import { Duration, OffsetTag, PeriodTag } from "@vestlang/dsl";
import { DurationDay, DurationMonth, Offsets } from "../types/index.js";

/** Construct a canonical Duration. */
function makeDuration(
  value: number,
  unit: "MONTHS",
  sign: OffsetTag,
): DurationMonth;
function makeDuration(
  value: number,
  unit: "DAYS",
  sign: OffsetTag,
): DurationDay;
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
  };
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
export function normalizeOffsets(offsets: Duration[]): Offsets {
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

  const monthDur =
    months !== 0
      ? makeDuration(Math.abs(months), "MONTHS", months < 0 ? "MINUS" : "PLUS")
      : undefined;

  const dayDur =
    days !== 0
      ? makeDuration(Math.abs(days), "DAYS", days < 0 ? "MINUS" : "PLUS")
      : undefined;

  if (monthDur && dayDur) return [monthDur, dayDur];
  if (monthDur) return [monthDur];
  if (dayDur) return [dayDur];
  return [];
}
