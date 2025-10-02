import type { BaseAmount } from "@vestlang/dsl";
import { invariant, unexpectedAst } from "../errors.js";
import type { Numeric } from "../types/oct-types.js";

/* ------------------------
 * Types
 * ------------------------ */

// types/vestlang/Amount
interface AmountPercent extends BaseAmount {
  type: "AmountPercent";
  numerator: Numeric;
  denominator: Numeric; // must not be "0" at runtime
  quantity?: never;
}

interface AmountAbsolute extends BaseAmount {
  type: "AmountAbsolute";
  value: number;
  numerator?: never;
  denominator?: never;
}

export type Amount = AmountPercent | AmountAbsolute;

/* ------------------------
 * Amount
 * ----------------------- */

export function normalizeAmount(astAmount: any, path: string[]): Amount {
  if (astAmount?.type === "AmountAbsolute") {
    invariant(
      typeof astAmount.value === "number",
      "AmountAbsolute.value must be a number",
      { value: astAmount.value },
      path,
    );
    return {
      type: "AmountAbsolute",
      value: astAmount.value,
    };
  }

  if (astAmount?.type === "AmountPercent") {
    const v = astAmount.value;

    invariant(
      typeof v === "number" && Number.isFinite(v),
      "AmountPercent.value must be a finite number",
      { value: v },
      path,
    );
    if (v >= 0 && v <= 1) {
      return {
        type: "AmountPercent",
        numerator: String(v * 100) as Numeric,
        denominator: "100" as Numeric,
      };
    }
    if (v > 1 && v <= 100) {
      return {
        type: "AmountPercent",
        numerator: String(v) as Numeric,
        denominator: "100" as Numeric,
      };
    }
    return unexpectedAst(
      "AmountPercent.value must be iether a fraction [0,1] or a percentage (1..100],",
      { value: v },
      path,
    );
  }
  // allow idempotency if a normalized version is ever passed in
  if (
    astAmount?.type === "AmountPercent" &&
    "numerator" in astAmount &&
    "denominator" in astAmount
  ) {
    return {
      type: "AmountPercent",
      numerator: astAmount.numerator as Numeric,
      denominator: astAmount.denominator as Numeric,
    };
  }
  return unexpectedAst("Unknown Amount variant", { astAmount }, path);
}
