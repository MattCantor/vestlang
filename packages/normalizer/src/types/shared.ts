import { BaseAmount } from "@vestlang/dsl";
import { Numeric } from "./oct-types.js";

/* ------------------------
 * Helpers / utility types
 * ------------------------ */

// Brand to mark integers at the type level
declare const __int: unique symbol;
export type Integer = number & { [__int]: "Integer" };

// Require at least two items for combinators.
export type TwoOrMore<T> = [T, T, ...T[]];

// Exhaustiveness helper
export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + String(x));
}

/* ------------------------
 * Amount
 * ----------------------- */

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

// enums/vestlang/ExpressionType
export type ExprType = "Schedule" | "LaterOfSchedules" | "EarlierOfSchedules";
