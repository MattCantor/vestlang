import type { ASTSchedule } from "@vestlang/dsl";
import { normalizePeriodicity, Periodicity } from "./periodicity.js";
import { foldCliffIntoStart } from "./cliff.js";
import {
  normalizeFromTermOrDefault,
  type VestingStartExpr,
} from "./vesting-start-date.js";
import type { BaseExpr } from "../types/shared.js";

/* ------------------------
 * Types
 * ------------------------ */

// types/vestlang/Schedule
export interface Schedule extends BaseExpr {
  type: "Schedule";
  vesting_start: VestingStartExpr;
  periodicity: Periodicity;
}

/* ------------------------
 * Schedule
 * ------------------------ */

export function normalizeSchedule(ast: ASTSchedule, path: string[]): Schedule {
  // Vesting start: FROM (may include combinators)
  const baseStart = normalizeFromTermOrDefault(ast.from, [...path, "from"]);

  // Periodicity: OVER / EVERY / CLIFF (may include combinators)
  const periodicity = normalizePeriodicity(ast.over, ast.every, [
    ...path,
    "periodicity",
  ]);

  // Cliff
  const vestingStart = foldCliffIntoStart(baseStart, ast.cliff, periodicity, [
    ...path,
    "cliff",
  ]);

  return {
    id: "",
    type: "Schedule",
    vesting_start: vestingStart,
    periodicity,
  };
}
