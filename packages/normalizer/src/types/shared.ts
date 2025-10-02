/* ------------------------
 * Helpers / utility types
 * ------------------------ */

// Brand to mark integers at the type level
declare const __int: unique symbol;
export type Integer = number & { [__int]: "Integer" };

// primitives/vestlang/Expression
export interface BaseExpr {
  id: string;
  type: ExprType;
}

// enums/vestlang/ExpressionType
export type ExprType = "Schedule" | "LaterOfSchedules" | "EarlierOfSchedules";

// Exhaustiveness helper
export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + String(x));
}
