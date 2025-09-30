import { PeriodType, VestingDayOfMonth } from "./oct-types.js"
import { Amount, Anchor, DateAnchor, EventAnchor, ExprType, Integer, TwoOrMore } from "./shared.js";


/* ------------------------
 * Vesting Start
 * ------------------------ */

// enums/vestlang/VestingStartType
// type VestingStartType =
// | "Date"
// | "Event"
// | "Qualified"

// primitives/vestlang/Window
export interface Window {
  start?: Anchor;
  end?: Anchor;
  inclusiveStart?: boolean;
  inclusiveEnd?: boolean;
}

// primitives/vestlang/VestingStart
interface BaseVestingStart {
  id: string;
  type: "Qualified" | "Unqualified"
  anchor: Anchor
}

export interface VestingStartDate extends BaseVestingStart {
  type: "Unqualified"
  anchor: DateAnchor
  window?: never
}

export interface VestingStartEvent extends BaseVestingStart {
  type: "Unqualified"
  anchor: EventAnchor
  window?: never
}

export interface VestingStartQualified extends BaseVestingStart {
  type: "Qualified";
  anchor: Anchor;
  window: Window;
}

export type VestingStart =
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

export type Expr = Schedule | ScheduleCombinator

/* ------------------------
 * Statement
  * ----------------------- */

export interface Statement {
  id: string;
  amount: Amount;
  expr: Expr;
}


