import { Anchor, DateAnchor, EventAnchor } from "@vestlang/dsl";
import { Amount, ExprType, Integer, TwoOrMore } from "./shared.js";
import { VestingDayOfMonth } from "./oct-types.js";

/* -------------
 * Window
 * ------------- */

export type BoundCandidate<A = Anchor> = {
  at: A; // Date | Event (still unresolved here)
  inclusive: boolean; // per-candicate inclusivity
};

export type StartWindow<A = Anchor> = {
  combine: "LaterOf"; // semantic: pick the latest start
  candidates: TwoOrMore<BoundCandidate<A>>;
};

export type EndWindow<A = Anchor> = {
  combine: "EarlierOf"; // semantic: pick the earlierst end
  candidates: TwoOrMore<BoundCandidate<A>>;
};

export type Window<A = Anchor> = {
  start?: StartWindow<A>;
  end?: EndWindow<A>;
};

/* ------------------------
 * Vesting Start
 * ------------------------ */

// primitives/vestlang/VestingStart
interface BaseVestingStart {
  id: string;
  type: "Qualified" | "Unqualified";
  anchor: Anchor;
}

export interface VestingStartDate extends BaseVestingStart {
  type: "Unqualified";
  anchor: DateAnchor;
  window?: never;
}

export interface VestingStartEvent extends BaseVestingStart {
  type: "Unqualified";
  anchor: EventAnchor;
  window?: never;
}

export interface VestingStartQualified extends BaseVestingStart {
  type: "Qualified";
  anchor: Anchor;
  window: Window;
}

export type VestingStart =
  | VestingStartDate
  | VestingStartEvent
  | VestingStartQualified;

// combinators over vesting starts
export interface EarlierOfVestingStart {
  id: string;
  type: "EarlierOf";
  items: TwoOrMore<VestingStartExpr>;
}

export interface LaterOfVestingStart {
  id: string;
  type: "LaterOf";
  items: TwoOrMore<VestingStartExpr>;
}

export type VestingStartExpr =
  | VestingStart
  | EarlierOfVestingStart
  | LaterOfVestingStart;

/* -------------------------
 * Periodicity
 * ------------------------ */

// types/vestlang/Periodicity
interface BasePeriodicity {
  id: string;
  span: Integer;
  count: Integer;
  step: Integer;
  cliff?: Integer;
}

export interface PeriodicityInDays extends BasePeriodicity {
  periodType: "DAYS";
  vesting_day_of_month?: never;
}

export interface PeriodicityInMonths extends BasePeriodicity {
  periodType: "MONTHS";
  vesting_day_of_month: VestingDayOfMonth;
}

export type Periodicity = PeriodicityInDays | PeriodicityInMonths;

/* -----------------------
 * Expr
 * ----------------------- */

// primitives/vestlang/Expression
interface BaseExpr {
  id: string;
  type: ExprType;
}

/* -------------------------
 * Schedule
 * ------------------------- */

// types/vestlang/Schedule
export interface Schedule extends BaseExpr {
  type: "Schedule";
  vesting_start: VestingStartExpr;
  periodicity: Periodicity;
}

/* -----------------------
 * LaterOfSchedules / EarlierOfSchedules
 * ----------------------- */

interface BaseScheduleCombinator extends BaseExpr {
  items: TwoOrMore<Expr>;
}

export interface LaterOfSchedules extends BaseScheduleCombinator {
  type: "LaterOfSchedules";
}

export interface EarlierOfSchedules extends BaseScheduleCombinator {
  type: "EarlierOfSchedules";
}

type ScheduleCombinator = LaterOfSchedules | EarlierOfSchedules;

export type Expr = Schedule | ScheduleCombinator;

/* ------------------------
 * Statement
 * ----------------------- */

export interface Statement {
  id: string;
  amount: Amount;
  expr: Expr;
}
