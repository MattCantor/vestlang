/* ------------------------
  * OCT Enums
  * ----------------------- */

// enums/VestingTriggerType
type VestingTriggerType =
| "VESTING_START_DATE"
| "VESTING_SCHEDULE_ABSOLUTE"
| "VESTING_SCHEDULE_RELATIVE"
| "VESTING_EVENT"

// enums/PeriodType
export type PeriodType = "DAYS" | "MONTHS" | "YEARS"

// enums/VestingDayOfMonth
export type VestingDayOfMonth =
| "01"
| "02"
| "03"
| "04"
| "05"
| "06"
| "07"
| "08"
| "09"
| "10"
| "11"
| "12"
| "13"
| "14"
| "15"
| "16"
| "17"
| "18"
| "19"
| "20"
| "21"
| "22"
| "23"
| "24"
| "25"
| "26"
| "27"
| "28"
| "29_OR_LAST_DAY_OF_MONTH"
| "30_OR_LAST_DAY_OF_MONTH"
| "31_OR_LAST_DAY_OF_MONTH"
| "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"


/* --------------------------
  * OCT Primitives
  * ------------------------- */

// primitives/types/vesting/VestingConditionTrigger
interface VestingConditionTrigger {
  type: VestingTriggerType
} 

// primitives/types/vesting/VestingPeriod
interface VestingPeriod {
  length: number;
  type: PeriodType;
  occurrences: number;
}

/* ---------------------------
  * OCT Types
  * -------------------------- */

// types/Numeric
export type Numeric = string & { readonly __numericBrand: unique symbol } // ^[+-]?[0-9]+(\\.[0-9]{1,10})?$

interface VestingStartTrigger extends VestingConditionTrigger {
  type: "VESTING_START_DATE"
}

interface VestingEventTrigger extends VestingConditionTrigger {
  type: "VESTING_EVENT"
}

interface VestingScheduleAbsoluteTrigger extends VestingConditionTrigger {
  type: "VESTING_SCHEDULE_ABSOLUTE"
}

interface VestingScheduleRelativeTrigger extends VestingConditionTrigger {
  type: "VESTING_SCHEDULE_RELATIVE"
}

// types/vesting/VestingConditionPortion
interface VestingConditionPortion {
  numerator: Numeric;
  denominator: Numeric;
  remainder?: boolean;
}

// types/vesting/VestingCondition
interface BaseVestingCondition {
  id: string;
  description?: string;
  trigger: VestingStartTrigger | VestingEventTrigger | VestingScheduleAbsoluteTrigger | VestingScheduleRelativeTrigger
  readonly next_condition_ids: readonly string[]
}

// types/vesting/VestingPeriodInDays
interface VestingPeriodInDays extends VestingPeriod {
  type: "DAYS"
}

// types/vesting/VestingPeriodInMonths
interface VestingPeriodInMonths extends VestingPeriod {
  type: "MONTHS"
  day_of_month: VestingDayOfMonth
}

declare const __isoDateBrand: unique symbol;
type OCTDate = string & { [__isoDateBrand]: never };

// types/Vesting
interface Vesting {
  date: OCTDate;
  amount: Numeric
}
