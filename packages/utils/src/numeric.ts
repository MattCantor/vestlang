// The OCF `Numeric` boundary: parse a stored fixed-point decimal back to an
// exact rational on the way in, and write an exact rational out as the shortest
// faithful decimal on the way out.
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

// A reduced fraction terminates as a decimal iff its denominator's only prime
// factors are 2 and 5. Strip both and see what's left.
export const terminates = (denominator: bigint): boolean => {
  let d = bigAbs(denominator);
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
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
 * A fraction whose exact decimal terminates within ten places is written
 * exactly — lossless, round-trips. Everything else (a repeating fraction, or a
 * terminating one that needs more than ten places) is truncated toward zero at
 * ten places, the engine's CUMULATIVE_ROUND_DOWN direction: 1/3 → "0.3333333333",
 * 1/2048 → "0.0004882812". The domain is non-negative — the producers only ever
 * hold a non-negative share — so a negative input is a bug and throws (it would
 * also make "truncate toward zero" ambiguous).
 */
export const fractionToNumeric = (f: Fraction): Numeric => {
  const num = BigInt(f.numerator);
  const den = BigInt(f.denominator);
  if (num < 0n) {
    throw new Error(
      `fractionToNumeric: expected a non-negative fraction (got ${f.numerator}/${f.denominator})`,
    );
  }
  if (den <= 0n) {
    throw new Error(
      `fractionToNumeric: denominator must be >= 1 (got ${f.denominator})`,
    );
  }

  const intPart = num / den;
  let remainder = num % den;
  if (remainder === 0n) return intPart.toString();

  // Emit fractional digits one place at a time, stopping early once the division
  // closes out (a terminating fraction) or at ten places (the OCF ceiling). Long
  // division keeps every digit exact; no float ever enters.
  let digits = "";
  for (let place = 0; place < MAX_PLACES && remainder !== 0n; place++) {
    remainder *= 10n;
    digits += (remainder / den).toString();
    remainder %= den;
  }
  // Strip any trailing zeros the exact expansion produced (e.g. 1/8 = 0.125
  // never grows them, but a denominator like 40 can), for minimal form.
  digits = digits.replace(/0+$/, "");
  return digits.length === 0 ? intPart.toString() : `${intPart}.${digits}`;
};
