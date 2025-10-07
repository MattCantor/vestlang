import type { ASTSchedule } from "@vestlang/dsl";
import { normalizePeriodicity, Periodicity } from "./periodicity.js";
import {
  normalizeFromTermOrDefault,
  type VestingStart,
} from "./vesting-start-date.js";
import type { BaseExpr } from "../types/shared.js";

/* ------------------------
 * Types
 * ------------------------ */

// types/vestlang/Schedule
export interface Schedule extends BaseExpr {
  type: "Schedule";
  vesting_start: VestingStart;
  periodicity: Periodicity;
}

/* ------------------------
 * Schedule
 * ------------------------ */

export function normalizeSchedule(ast: ASTSchedule, path: string[]): Schedule {
  // Vesting start: FROM (may include combinators)
  const vesting_start = normalizeFromTermOrDefault(ast.from, [...path, "from"]);

  // Periodicity: OVER / EVERY / CLIFF (may include combinators)
  const periodicity = normalizePeriodicity(ast.over, ast.every, [
    ...path,
    "periodicity",
  ]);

  // Cliff
  periodicity.cliff = ast.cliff;

  return {
    id: "",
    type: "Schedule",
    vesting_start,
    periodicity,
  };
}
