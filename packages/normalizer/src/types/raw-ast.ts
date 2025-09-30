import { PeriodType } from "./oct-types.js";
import { Anchor, Amount, ExprType, TwoOrMore } from "./shared.js";


// enums/vestlang/PredicateType
type PredicateType =
| "Before"
| "After"
| "Between"


interface Predicate {
  type: PredicateType;
  anchor: Anchor;
  strict: boolean;
}

/* -------------------
 * Duration
 * ------------------- */

// primitives/vestlang/Duration
interface BaseDuration {
  type: "Duration" | "Zero";
  unit?: PeriodType;
  value?: number;
}

interface DurationInDays extends BaseDuration {
  type: "Duration";
  unit: "DAYS";
  value: number;
}

interface DurationInMonths extends BaseDuration {
  type: "Duration";
  unit: "MONTHS";
  value: number;
}

interface ZeroDuration extends BaseDuration {
  type: "Zero"
}

type Duration = DurationInDays | DurationInMonths | ZeroDuration;

/* --------------------
 * QualifiedFrom
 * -------------------- */

interface QualifiedFrom {
  type: "Qualified",
  base: Anchor;
  predicates: Predicate;
}

/* --------------------
 * FromEarlierOf / FromLaterOf
 * -------------------- */

interface FromCombinator {
  type: "EarlierOf" | "LaterOf";
  items: (Anchor | QualifiedFrom)[];
}

/* --------------------
 * ASTExpr
 * -------------------- */

interface BaseASTExpr {
  type: ExprType
}

interface ASTSchedule extends BaseASTExpr {
  type: "Schedule";
  from?: Anchor | QualifiedFrom | FromCombinator;
  over: Duration;
  every: Duration;
  cliff: Duration;
}

/* ---------------------
 * LaterOfSchedules / EarlierOfSchedules
 * --------------------- */

interface BaseASTScheduleCombinator extends BaseASTExpr {
  items: TwoOrMore<ASTSchedule>;
}

interface LaterOfASTSchedules extends BaseASTScheduleCombinator {
  type: "LaterOfSchedules"
}

interface EarlierOfASTSchedules extends BaseASTScheduleCombinator {
  type: "EarlierOfSchedules"
}

type ASTScheduleCombinator =
| LaterOfASTSchedules
| EarlierOfASTSchedules

export type ASTExpr = ASTSchedule | ASTScheduleCombinator
/* ---------------------
 * ASTStatement
 * --------------------- */

export interface ASTStatement {
  amount: Amount
  expr: ASTExpr
}
