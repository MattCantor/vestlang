/* ------------------------
 * Periodicity
 * ------------------------ */

import { Duration } from "@vestlang/dsl";
import {
  Periodicity,
  PeriodicityInDays,
  PeriodicityInMonths,
} from "../types/normalized.js";
import { invariant } from "../errors.js";
import { Integer } from "../types/shared.js";

export function normalizePeriodicity(
  over: Duration | undefined,
  every: Duration | undefined,
  path: string[],
): Periodicity {
  invariant(
    over && every,
    "Both OVER and EVERY are required",
    { over, every },
    path,
  );
  invariant(
    over.unit === every.unit,
    "OVER and EVERY units must match",
    { over, every },
    path,
  );

  const span = over.value as Integer;
  const step = every.value as Integer;

  invariant(
    (span === 0 && step === 0) || span % step === 0,
    "OVER must be a multiple of EVERY",
    { over, every },
    path,
  );
  const count =
    span === 0 && step === 0 ? (1 as Integer) : ((span / step) as Integer);

  if (over.unit === "DAYS") {
    const p: PeriodicityInDays = {
      id: "",
      periodType: "DAYS",
      span,
      step,
      count,
    };
    return p;
  }

  // MONTHS: need vesting_day_of_month
  const p: PeriodicityInMonths = {
    id: "",
    periodType: "MONTHS",
    span,
    step,
    count,
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH", // TODO: figure out how to supply this downstream
  };
  return p;
}

export function unitOfPeriodicity(p: Periodicity) {
  return p.periodType === "DAYS" ? "DAYS" : "MONTHS";
}
