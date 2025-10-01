import { Anchor, DateAnchor, EventAnchor } from "@vestlang/dsl";
import { Numeric, PeriodType, VestingDayOfMonth } from "./types/oct-types.js"

/* ------------------------
 * Helpers / utility types
 * ------------------------ */

// Brand to mark integers at the type level
declare const __int: unique symbol;
type Integer = number & { [__int]: "Integer"}

// Require at least two items for combinators.
type TwoOrMore<T> = [T, T, ...T[]]

// Exhaustiveness helper
export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + String(x))
}

/* ------------------------
  * Amount
  * ----------------------- */

// enums/vestlang/AmountType
type AmountType =
| "Amount_Percent"
| "Amount_Absolute"

// primitives/types/vestlang/Amount
interface BaseAmount { 
  type: AmountType
} 

// types/vestlang/Amount
interface AmountPercent extends BaseAmount {
  type: "Amount_Percent",
  numerator: Numeric;
  denominator: Numeric; // must not be "0" at runtime
  quantity?: never;
}

interface AmountAbsolute extends BaseAmount {
  type: "Amount_Absolute";
  value: number;
  numerator?: never;
  denominator?: never;
};

type Amount = AmountPercent | AmountAbsolute

/* ------------------------
 * Vesting Start
 * ------------------------ */

// enums/vestlang/VestingStartType
type VestingStartType =
| "Date"
| "Event"
| "Qualified"

// primitives/vestlang/Window
interface Window {
  start: Anchor;
  end: Anchor;
  inclusiveStart: boolean;
  inclusiveEnd: boolean;
}

// primitives/vestlang/VestingStart
interface BaseVestingStart {
  id: string;
  type: VestingStartType
  anchor: Anchor
}

interface VestingStartDate extends BaseVestingStart {
  type: "Date"
  anchor: DateAnchor
  window?: never
}

interface VestingStartEvent extends BaseVestingStart {
  type: "Event"
  anchor: EventAnchor
  window?: never
}

interface VestingStartQualified extends BaseVestingStart {
  type: "Qualified";
  anchor: Anchor;
  window: Window;
}

type VestingStart =
| VestingStartDate
| VestingStartEvent
| VestingStartQualified

/* -------------------------
 * Periodicity
 * ------------------------ */

// types/vestlang/Periodicity
interface BasePeriodicity {
  id: string;
  periodType: PeriodType;
  span: Integer;
  count: Integer;
  step: Integer;
  cliff?: Integer;
}

interface PeriodicityInDays extends BasePeriodicity {
  periodType: "DAYS"
}

interface PeriodicityInMonths extends BasePeriodicity {
  periodType: "MONTHS"
  vesting_day_of_month: VestingDayOfMonth;
}

type Periodicity = PeriodicityInDays | PeriodicityInMonths;

/* -----------------------
 * Expr
 * ----------------------- */

// enums/vestlang/ExpressionType
type ExprType =
| "Schedule"
| "LaterOfSchedules"
| "EarlierOfSchedules"

// primitives/vestlang/Expression
interface BaseExpr {
  id: string;
  type: ExprType
}

/* -------------------------
 * Schedule
 * ------------------------- */

// types/vestlang/Schedule
interface Schedule extends BaseExpr {
  type: "Schedule";
  vesting_start: VestingStart;
  periodicity: Periodicity;
}

/* -----------------------
 * LaterOfSchedules / EarlierOfSchedules
 * ----------------------- */

interface BaseScheduleCombinator extends BaseExpr {
  items: TwoOrMore<Schedule>;
}

interface LaterOfSchedules extends BaseScheduleCombinator {
  type: "LaterOfSchedules";
}

interface EarlierOfSchedules extends BaseScheduleCombinator {
  type: "EarlierOfSchedules";
}

type ScheduleCombinator =
| LaterOfSchedules
| EarlierOfSchedules

type Expr = Schedule | ScheduleCombinator

/* ------------------------
 * Statement
  * ----------------------- */

export interface Statement {
  id: string;
  amount: Amount;
  expr: Expr;
}


