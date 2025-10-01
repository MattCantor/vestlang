/* ------------------------
 * Schedule
 * ------------------------ */

import { ASTSchedule } from "@vestlang/dsl";
import { Schedule } from "../types/normalized.js";
import { normalizePeriodicity } from "./periodicity.js";
import { foldCliffIntoStart } from "./cliff.js";
import { normalizeFromTermOrDefault } from "./vesting-start-date.js";

export function normalizeSchedule(ast: ASTSchedule, path: string[]): Schedule {
  // Vesting start: FROM (may include combinators)
  const baseStart = normalizeFromTermOrDefault(ast.from, [...path, "from"]);

  // Periodicity: OVER / EVERY
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
