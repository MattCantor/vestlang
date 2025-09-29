/*****************
 * Existing OCT JSON Schemas
 *****************/

// schema/types/Numeric.schema.json
export type NumericType = string; // "^[+-]?[0-9]+(\\.[0-9]{1,10})?$"

// schema/types/Date.schema.json
export type DateType = string;

// schema/enums/PeriodType.schema.json
export type PeriodType = "DAYS" | "MONTHS"; // the OCT schema also includes "YEARS". Excluded intentionally

// schema/primitives/types/vesting/VestingPeriod.schema.json
export type VestingPeriod = {
  length: number; // The quantity of 'type' units of time; e.g. 3 for 3 months. TODO: is this better referred to as "Every"
  type: PeriodType;
  occurrences: number; // The number of times this vesting period triggers, e.g. for 48 for 48 months. TODO: is this better referred to as "Over"
};

// NOTE: Current OCT JSON SCHEMA uses "length", "type", and "occurrences" to derive the total length of the schedule.  Vestlang DSL uses "over" to set the length of the schedule, with "every" to determine the cadence. The drawback of the vestlang approach is that "over" must be divisible by "every".

/***************
 * Modified Vesting Period Type
 ***************/
export type ModifiedVestingPeriod = {
  duration: Duration;
};

// schema/enums/VestingDayOfMonth.schema.json
export type VestingDayOfMonth = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
];
// schema/types/vesting/VestingPeriodInMonths.schema.json
export type VestingPeriodInMonths = VestingPeriod & {
  type: "MONTHS";
  day_of_month: VestingDayOfMonth;
};

// schema/types/vesting/VestingPeriodInDays.schema.json
export type VestingPeriodinDays = VestingPeriod & {
  type: "DAYS";
};

// schema/types/vesting/VestingConditionPortion.schema.json
export type VestingConditionPortion = {
  numerator: NumericType;
  denominator: NumericType; // TODO: change this so it can't be zero
  remainder?: boolean;
};

// schema/types/vesting/VestingCondition.schema.json
export type VestingCondition = {
  id: string;
  description: string;
  portion: VestingConditionPortion;
  quantity: NumericType;
};

/***********************
 * New JSON Schemas
 ***********************/

export type Amount = {
  type: "Amount";
  value: number;
};

export type Duration = {
  type: "Duration";
  value: number;
  unit: PeriodType;
};

export type DateAtom = {
  type: "Date";
  iso: DateType;
};

export type EventAtom = {
  type: "Event";
  name: string;
};

export type Cliff = { type: "Zero" } | Duration | DateAtom | EventAtom;

export type ScheduleBlock = {
  from: DateAtom | EventAtom | null;
  over: Duration;
  every: Duration;
  cliff: Cliff;
};

export type Condition =
  | { type: "EarlierOf"; items: Condition[] }
  | { type: "LaterOf"; items: Condition[] }
  | { type: "At"; item: DateAtom | EventAtom }
  | { type: "None" };

export type Clause = {
  type: "Clause";
  schedule: ScheduleBlock | null; // null only for IF-only sugar until normalized
  if: Condition;
};

export type Expr =
  | Clause
  | { type: "EarlierOfClauses"; items: Expr[] }
  | { type: "LaterOfClauses"; items: Expr[] };

export type StartNode = { amount: Amount; expr: Expr };
