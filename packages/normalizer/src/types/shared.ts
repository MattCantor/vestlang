import { Numeric, OCTDate } from "../oct-types.js";

/* ------------------------
 * Helpers / utility types
 * ------------------------ */

// Brand to mark integers at the type level
declare const __int: unique symbol;
export type Integer = number & { [__int]: "Integer"}

// Require at least two items for combinators.
export type TwoOrMore<T> = [T, T, ...T[]]

// Exhaustiveness helper
export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + String(x))
}


/* ------------------------
  * Amount
  * ----------------------- */

// enums/vestlang/AmountType
type AmountType =
| "Amount_Percent"
| "Amount_Absolute"

// primitives/types/vestlang/Amount
interface BaseAmount { 
  type: AmountType
} 

// types/vestlang/Amount
interface AmountPercent extends BaseAmount {
  type: "Amount_Percent",
  numerator: Numeric;
  denominator: Numeric; // must not be "0" at runtime
  quantity?: never;
}

interface AmountAbsolute extends BaseAmount {
  type: "Amount_Absolute";
  value: number;
  numerator?: never;
  denominator?: never;
};

export type Amount = AmountPercent | AmountAbsolute

/* ----------------------------
  * Anchor
  * --------------------------- */

// primitives/vestlang/EventAnchor
interface BaseAnchor {
  type: AnchorType
}

export interface DateAnchor extends BaseAnchor {
  type: "Date"
  value: OCTDate
}

export interface EventAnchor extends BaseAnchor {
  type: "Event"
  value: string
}

// types/vestlang/Anchor
export type Anchor = DateAnchor | EventAnchor


// enums/vestlang/AnchorType
export type AnchorType =
| "Date"
| "Event"

// enums/vestlang/ExpressionType
export type ExprType =
| "Schedule"
| "LaterOfSchedules"
| "EarlierOfSchedules"

