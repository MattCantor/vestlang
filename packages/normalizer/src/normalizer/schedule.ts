import type { Anchor, ASTSchedule } from "@vestlang/dsl";
import { normalizePeriodicity, Periodicity } from "./periodicity.js";
import {
  normalizeFromTermOrDefault,
  type VestingStart,
} from "./vesting-start-date.js";
import type { BaseExpr } from "../types/shared.js";
import { normalizeAnchorConstraints } from "./constraints.js";

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

  // Cliff: only normalize if it's an Anchor
  // leave Duration / selector untouched
  if (ast.cliff && typeof (ast.cliff as any).type === "string") {
    const t = (ast.cliff as any).type;
    if (t === "Date" || t === "Event" || t === "Constrained") {
      periodicity.cliff = normalizeAnchorConstraints(ast.cliff as Anchor);
    } else {
      periodicity.cliff = ast.cliff;
    }
  } else {
    periodicity.cliff = ast.cliff;
  }

  return {
    id: "",
    type: "Schedule",
    vesting_start,
    periodicity,
  };
}
