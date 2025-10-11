import { Cliff, Duration, PeriodTypeEnum } from "@vestlang/dsl";
import { invariant } from "../errors.js";
import type { Integer } from "../types/shared.js";
import type { VestingDayOfMonth } from "../types/oct-types.js";

/* ------------------------
 * Types
 * ------------------------ */

// types/vesting/VestingPeriod.schema.json
// existing OCT schema
interface VestingPeriod {
  type: PeriodTypeEnum;
  occurrences: Integer; // the installment count
  length: Integer; // the installment step
  cliff?: Cliff;
}

// types/vesting/VestingPeriodInDays
// existing OCT schema
interface VestingPeriodInDays extends VestingPeriod {
  type: PeriodTypeEnum.DAYS;
  vesting_day_of_month?: never;
}

// types/vesting/VestingPeriodInMonths
// existing OCT schema
interface VestingPeriodInMonths extends VestingPeriod {
  type: PeriodTypeEnum.MONTHS;
  vesting_day_of_month: VestingDayOfMonth;
}

export type Periodicity = VestingPeriodInDays | VestingPeriodInMonths;

/* ------------------------
 * Periodicity
 * ------------------------ */

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

  const span = over.value;
  const length = every.value as Integer;

  invariant(
    (span === 0 && length === 0) || span % length === 0,
    "OVER must be a multiple of EVERY",
    { over, every },
    path,
  );
  const occurrences =
    span === 0 && length === 0 ? (1 as Integer) : ((span / length) as Integer);

  if (over.unit === PeriodTypeEnum.DAYS) {
    const p: VestingPeriodInDays = {
      type: PeriodTypeEnum.DAYS,
      length,
      occurrences,
    };
    return p;
  }

  // MONTHS: need vesting_day_of_month
  const p: VestingPeriodInMonths = {
    type: PeriodTypeEnum.MONTHS,
    length,
    occurrences,
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH", // TODO: figure out how to supply this downstream
  };
  return p;
}

export function unitOfPeriodicity(p: Periodicity) {
  return p.type === PeriodTypeEnum.DAYS
    ? PeriodTypeEnum.DAYS
    : PeriodTypeEnum.MONTHS;
}
