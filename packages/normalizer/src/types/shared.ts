import { ExprEnum } from "@vestlang/dsl";

/* ------------------------
 * Helpers / utility types
 * ------------------------ */

// Brand to mark integers at the type level
declare const __int: unique symbol;
export type Integer = number & { [__int]: "Integer" };

// primitives/types/vestlang/VestlandExpression
export interface VestlangExpression {
  id: string;
  description?: string;
  type: ExprEnum;
}

// Exhaustiveness helper
export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + String(x));
}
