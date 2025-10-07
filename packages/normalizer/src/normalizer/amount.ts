import type { BaseAmount } from "@vestlang/dsl";
import { invariant, unexpectedAst } from "../errors.js";
import type { Numeric } from "../types/oct-types.js";

/* ------------------------
 * Types
 * ------------------------ */

// types/vestlang/Amount
interface AmountPercent extends BaseAmount {
  type: "AmountPercent";
  value: Numeric;
}

interface AmountAbsolute extends BaseAmount {
  type: "AmountAbsolute";
  value: Numeric;
}

export type Amount = AmountPercent | AmountAbsolute;

/* ------------------------
 * Amount
 * ----------------------- */

export function normalizeAmount(astAmount: any, path: string[]): Amount {
  const value = astAmount.value;

  invariant(
    typeof value === "number",
    "Amount value must be a number",
    {
      value,
    },
    path,
  );

  invariant(
    Number.isFinite(value),
    "Amount value must be a finite number",
    { value },
    path,
  );

  if (astAmount?.type === "AmountPercent") {
    if (value >= 0 && value <= 1) {
      return {
        type: "AmountPercent",
        value: String(value * 100) as Numeric,
      };
    }
    if (value > 1 && value <= 100) {
      return {
        type: "AmountPercent",
        value: String(value) as Numeric,
      };
    }
    return unexpectedAst(
      "AmountPercent.value must be either a fraction [0,1] or a percentage (1..100].",
      { value },
      path,
    );
  }

  if (astAmount?.type === "AmountAbsolute") {
    return {
      type: "AmountAbsolute",
      value: String(value) as Numeric,
    };
  }

  return unexpectedAst("Unknown Amount variant", { astAmount }, path);
}
