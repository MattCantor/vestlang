// The OCF `Numeric` boundary: parse a stored fixed-point decimal back to an
// exact rational on the way in, and write an exact rational out as the shortest
// decimal the grammar can hold on the way out.
//
// canonical stores a vesting percentage as a `Numeric` string, not as a
// `Fraction`, so the interchange never claims a precision a fixed-point decimal
// can't hold (a 1/3 cliff is exact as 1/3 but a decimal can only write
// 0.3333…). The engine still does its share math in exact rational, so every
// read of a stored percentage parses the decimal here, and every write of a
// computed share renders here.
//
// This file also owns the shared OCF grammar/parse/render primitives — the
// pattern lives in @vestlang/types, the BigInt parse and the fixed-point render
// live here — so `precision.ts` (the analyzer) imports them rather than keeping
// its own copy. One definition of what a Numeric is and how its digits map to a
// value.

import type { Fraction, Numeric } from "@vestlang/types";
import { NUMERIC_PATTERN } from "@vestlang/types";

/** A Numeric decomposed into its exact value, scaledValue / 10^places. */
export interface ParsedDecimal {
  places: number;
  scaledValue: bigint;
  scale: bigint;
}

const bigAbs = (v: bigint): bigint => (v < 0n ? -v : v);

const bigGcd = (a: bigint, b: bigint): bigint => {
  let x = bigAbs(a);
  let y = bigAbs(b);
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x || 1n;
};

// Shape check against the single shared grammar. The persist zod schema and
// validate.ts use this same regex (via NUMERIC_PATTERN_SOURCE), so all three
// agree on exactly which strings are Numeric.
export const isNumeric = (value: unknown): value is Numeric =>
  typeof value === "string" && NUMERIC_PATTERN.test(value);

/** Throw on anything that isn't an OCF Numeric; otherwise return it unchanged. */
export const validateNumeric = (value: unknown): Numeric => {
  if (!isNumeric(value)) {
    throw new Error(
      `expected an OCF Numeric string (got ${JSON.stringify(value)})`,
    );
  }
  return value;
};

// Split a Numeric into BigInt parts: the digits as one integer over 10^places.
// The pattern's permissive forms are read canonically, not rejected — "+3" and
// "01" parse as 3, "-0.5" parses to a negative scaledValue (the sign rides into
// the value). Callers that forbid a sign (the producers) check it themselves;
// this is the value-faithful decode.
export const parseDecimal = (decimal: string): ParsedDecimal => {
  if (!isNumeric(decimal)) {
    throw new Error(
      `expected an OCF Numeric string (got ${JSON.stringify(decimal)})`,
    );
  }
  const negative = decimal.startsWith("-");
  const unsigned = decimal.replace(/^[+-]/, "");
  const [intPart, fracPart = ""] = unsigned.split(".");
  const places = fracPart.length;
  const magnitude = BigInt(intPart + fracPart);
  const scaledValue = negative ? -magnitude : magnitude;
  const scale = 10n ** BigInt(places);
  return { places, scaledValue, scale };
};

// Render a non-negative integer numerator over 10^places as a fixed-point
// decimal: leading "0." for sub-1 values, exactly `places` fractional digits.
// Built from the integer alone (no float division) so it stays exact. `places`
// of 0 returns the integer with no point.
export const renderFixed = (numerator: bigint, places: number): string => {
  if (places === 0) return numerator.toString();
  const padded = numerator.toString().padStart(places + 1, "0");
  const cut = padded.length - places;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PLACES = 10;

// The grid every stored `Numeric` lives on: one value is an integer count of
// 10^-MAX_PLACES units.
const GRID = 10n ** BigInt(MAX_PLACES);

/**
 * Parse a stored `Numeric` to its exact rational value, reduced to a
 * `number`-based `Fraction`. "0.3333" → 3333/10000, "0.25" → 1/4, "3" → 3/1,
 * "-0.5" → -1/2. Throws past Number.MAX_SAFE_INTEGER after reduction, matching
 * fractions.ts's `toFraction` — a component that survives reduction but can't be
 * held exactly is refused loudly rather than silently rounded.
 */
export const numericToFraction = (n: Numeric): Fraction => {
  const { scaledValue, scale } = parseDecimal(n);
  const g = bigGcd(scaledValue, scale);
  const num = scaledValue / g;
  const den = scale / g;
  const overflows = (v: bigint): boolean => bigAbs(v) > MAX_SAFE;
  if (overflows(num) || overflows(den)) {
    throw new Error(
      `Numeric ${JSON.stringify(n)} reduces to ${num}/${den}, which exceeds ` +
        `Number.MAX_SAFE_INTEGER and can't be held exactly as a Fraction`,
    );
  }
  return { numerator: Number(num), denominator: Number(den) };
};

// Like numericToFraction but returns null instead of throwing when the value
// is malformed or can't be held exactly as a number-based Fraction (past
// MAX_SAFE) — for boundary code that must refuse gracefully, not crash. A
// well-formed but oversized Numeric (e.g. "99999999999999999999") passes the
// grammar but can't round-trip through a number, so it lands here as null.
export const tryNumericToFraction = (n: Numeric): Fraction | null => {
  if (!isNumeric(n)) return null;
  const { scaledValue, scale } = parseDecimal(n);
  const g = bigGcd(scaledValue, scale);
  const num = scaledValue / g;
  const den = scale / g;
  if (bigAbs(num) > MAX_SAFE || bigAbs(den) > MAX_SAFE) return null;
  return { numerator: Number(num), denominator: Number(den) };
};

/**
 * Write a non-negative `Fraction` as a stored `Numeric`, in minimal canonical
 * form (no trailing zeros, no needless decimal point: 1/2 → "0.5", 1/1 → "1").
 *
 * A fraction that lands exactly on the ten-place grid is written exactly —
 * lossless, round-trips. Everything else (a repeating fraction, or a terminating
 * one needing more places than the grammar allows) is written as the next grid
 * value UP: 1/3 → "0.3333333334", 1/2048 → "0.0004882813".
 *
 * Up rather than down because of what happens after the write. Share math floors
 * a running cumulative, so a stored value a hair *below* the true fraction costs
 * a whole share exactly when the true count is a round number — which is the
 * case schedules are built to hit (a third of a three-year grant; a 19-month
 * cliff on a 48-month grid). A value a hair above is absorbed by that same floor
 * and lands on the intended count. The overshoot is under 10^-10 of the grant, so
 * it can only ever add a share where the true count already sat within
 * grant/10^10 of the next whole one.
 *
 * The domain is non-negative — the producers only ever hold a non-negative share
 * — so a negative input is a bug and throws.
 */
export const fractionToNumeric = (f: Fraction): Numeric => {
  const { num, den } = checkedParts(f, "fractionToNumeric");
  return renderGridUnits(ceilGridUnits(num, den));
};

// The rounding step, as one exact operation: ceil(num × 10^10 / den), integer part
// included. Rounding the whole value rather than nudging the last of ten
// accumulated digits is what makes the carry out of the tenth place fall out for
// free — 1 − 10^-11 becomes 10^10 units, which renders "1", where bumping a digit
// string would hand back an eleven-digit fraction the grammar rejects.
const ceilGridUnits = (num: bigint, den: bigint): bigint => {
  const scaled = num * GRID;
  const whole = scaled / den;
  return scaled % den === 0n ? whole : whole + 1n;
};

// Render an integer count of 10^-10 units as a minimal Numeric. The trailing-zero
// trim has to run after the rounding, not before it: 0.12345678995 rounds to
// 1234567900 units, which is "0.12345679". The decimal point stops the trim from
// eating an integer's own zeros ("20.0000000000" → "20").
const renderGridUnits = (units: bigint): Numeric =>
  renderFixed(units, MAX_PLACES).replace(/0+$/, "").replace(/\.$/, "");

// The producers only ever hold a non-negative share, so anything else is a bug.
// `caller` names the entry point it arrived through.
const checkedParts = (
  f: Fraction,
  caller: string,
): { num: bigint; den: bigint } => {
  const num = BigInt(f.numerator);
  const den = BigInt(f.denominator);
  if (num < 0n) {
    throw new Error(
      `${caller}: expected a non-negative fraction (got ${f.numerator}/${f.denominator})`,
    );
  }
  if (den <= 0n) {
    throw new Error(
      `${caller}: denominator must be >= 1 (got ${f.denominator})`,
    );
  }
  return { num, den };
};

/**
 * Apportion a schedule's statement share `Fraction`s to stored `Numeric`s
 * *together*, so the schedule's running total tracks the exact one at every
 * boundary instead of each statement rounding alone and the set drifting off the
 * total the author wrote.
 *
 * The running total is the thing to control because it is the only thing the
 * engine reads. The realizer never multiplies a stored statement decimal by the
 * grant on its own: it walks one cumulative over the whole sorted event stream
 * and takes differences of floors, so what a statement pays is the gap between
 * two cumulative floors. Round each *cumulative* up to the grid, store the
 * consecutive differences, and both properties follow — every boundary sits at or
 * just above its true value (the direction the flooring share math absorbs), and
 * the final boundary is the authored total on the grid, so nothing is invented or
 * lost across the schedule.
 *
 * Expect an individual statement's stored decimal to sit a hair *below* its own
 * exact fraction as a result — three thirds store
 * `["0.3333333334", "0.3333333333", "0.3333333333"]`. That is not a defect: no
 * per-statement decimal is ever the thing multiplied by the grant.
 *
 * One cap. An authored total strictly below 100% must not round up TO 100%: the
 * DSL admits fifteen fractional digits, so `0.999999999999` would otherwise reach
 * a full grant and vest a share nobody scheduled. The cap holds *every* boundary
 * at 10^10 − 1 in that case, not merely the last — an interior boundary can
 * already have reached the full grid, and pulling only the final one back under it
 * would leave a negative difference. Capping the whole sequence keeps it
 * non-decreasing, so a negative stored share can't arise.
 *
 * A total at or above 100% gets no cap: an over-allocation is stored faithfully
 * and refused by the allocation gate downstream rather than quietly reshaped here.
 */
export const apportionStored = (fractions: Fraction[]): Numeric[] => {
  if (fractions.length === 0) return [];

  // The exact running total as a reduced BigInt rational (reduced each step, or a
  // long chain of denominators multiplies out of hand), and its grid boundary
  // ceil(total × 10^10) at each statement.
  let cumN = 0n;
  let cumD = 1n;
  const boundaries: bigint[] = [];
  for (const f of fractions) {
    const { num, den } = checkedParts(f, "apportionStored");
    cumN = cumN * den + num * cumD;
    cumD *= den;
    const g = bigGcd(cumN, cumD);
    cumN /= g;
    cumD /= g;
    boundaries.push(ceilGridUnits(cumN, cumD));
  }

  const ceiling = GRID - 1n;
  const capped =
    cumN < cumD // the authored total is under 100%
      ? boundaries.map((b) => (b > ceiling ? ceiling : b))
      : boundaries;

  // Each statement stores the gap its boundary opened — already an exact count of
  // grid units, so it goes straight to the renderer `fractionToNumeric` itself ends
  // at, and comes out in the same minimal form ("0.5", "1").
  let previous = 0n;
  return capped.map((boundary) => {
    const stored = boundary - previous;
    previous = boundary;
    return renderGridUnits(stored);
  });
};
