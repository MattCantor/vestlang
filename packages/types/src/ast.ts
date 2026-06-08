import {
  AmountTag,
  ConditionTag,
  ConstraintTag,
  OffsetTag,
  PeriodTag,
} from "./enums.js";
import type { SourceLocation } from "./diagnostic.js";
import { OCTDate, Selector, TwoOrMore } from "./helpers.js";

// The DSL AST exists in two phases, tracked by this parameter:
//   "raw"        — straight off the parser: a vesting start may be null and a
//                  cliff may still be a bare Duration.
//   "normalized" — after the normalizer runs: starts are resolved to a node and
//                  cliffs to a VestingNodeExpr.
// "normalized" is the default, so the unparameterized types (Schedule, Program,
// …) describe the normalized shape and the Raw* aliases pin the raw phase.
//
// This is NOT the same "canonical" as ./canonical.ts. There, canonical means the
// OCF/Carta interchange — a different layer. Here we mean "normalized by our own
// normalizer," which is why the value is named accordingly.
type Phase = "raw" | "normalized";

/* ------------------------
 * Durations
 * ------------------------ */

// types/vestlang/CliffDuration.schema.json
export interface Duration {
  type: "DURATION";
  value: number;
  unit: PeriodTag;
  sign: OffsetTag;
}

export interface DurationMonth extends Duration {
  unit: "MONTHS";
}

export interface DurationDay extends Duration {
  unit: "DAYS";
}

/* ------------------------
 * Offsets
 * ------------------------ */

export type Offsets =
  | readonly []
  | readonly [DurationMonth | DurationDay]
  | readonly [DurationMonth, DurationDay];

/* ------------------------
 * Vesting Base
 * ------------------------ */

// primitives/vestlang/VestingBase.schema.json
// A vesting anchor. Four kinds, each its own tag so "is this a genuine event?" is
// the discriminant rather than a string test against the anchor value:
//   DATE          — a calendar date.
//   GRANT_DATE    — the runtime grant-date anchor (resolved from ctx.grantDate).
//   VESTING_START — the per-statement vesting-start anchor a cliff hangs off
//                   (resolved from the overlay ctx.vestingStart).
//   EVENT         — a genuine named milestone (ipo, …); never a system anchor.
// The two system anchors carry no value: any offset (`FROM grantDate + 12mo`)
// lives on the enclosing VestingNode, not the base. Exported as the union so
// callers narrow on `type`; there is intentionally no wide `{ type: VBaseTag }`
// base type to annotate against (that would discard the discriminant).
export interface VestingBaseDate {
  type: "DATE";
  value: OCTDate;
}

export interface VestingBaseGrantDate {
  type: "GRANT_DATE";
}

export interface VestingBaseVestingStart {
  type: "VESTING_START";
}

export interface VestingBaseEvent {
  type: "EVENT";
  value: string;
}

export type VestingBase =
  | VestingBaseDate
  | VestingBaseGrantDate
  | VestingBaseVestingStart
  | VestingBaseEvent;

/** The two normalizer-minted system anchors, distinct from genuine events. */
export type VestingBaseSystem = VestingBaseGrantDate | VestingBaseVestingStart;

/* ------------------------
 * Vesting Node
 * ------------------------ */

// primitives/types/vestlang/VestingNode.schema.json
export interface VestingNode {
  type: "NODE";
  base: VestingBase;
  offsets: Offsets;
  condition?: Condition;
}

export type ConstrainedVestingNode = VestingNode & {
  condition: Condition;
};

export type LaterOfVestingNode = Selector<VestingNodeExpr, "NODE_LATER_OF">;

export type EarlierOfVestingNode = Selector<VestingNodeExpr, "NODE_EARLIER_OF">;

export type VestingNodeExpr =
  | VestingNode
  | LaterOfVestingNode
  | EarlierOfVestingNode;

/* ------------------------
 * Conditions & Constraints
 * ------------------------ */

interface BaseCondition {
  type: ConditionTag;
  // Transient parser annotations: present on the raw AST, stripped by the
  // normalizer, so a normalized Condition never carries them. They exist only to
  // surface the bare mixed-infix AND/OR case (the `no-implicit-mixed-boolean`
  // finding) and are not part of the canonical interchange (./canonical.ts).
  //   grouped    — the node came from explicit grouping: parens or AND(…)/OR(…).
  //   mixedInfix — set on an infix OR with an un-grouped infix AND operand
  //                (`a OR b AND c`); the value is the OR's source span.
  grouped?: boolean;
  mixedInfix?: SourceLocation;
}

export interface AtomCondition extends BaseCondition {
  type: "ATOM";
  constraint: Constraint;
}

export interface AndCondition extends BaseCondition {
  type: "AND";
  items: TwoOrMore<Condition>;
}

export interface OrCondition extends BaseCondition {
  type: "OR";
  items: TwoOrMore<Condition>;
}

export type Condition = AtomCondition | AndCondition | OrCondition;

export interface Constraint {
  type: ConstraintTag;
  // The reference anchor is a single VestingNode, never a VestingNodeExpr. A
  // BEFORE/AFTER relation needs one comparison point, so selectors
  // (EARLIER/LATER OF), which denote a set of candidate dates, are disallowed
  // here. Keeping it a plain node also bounds the evaluator: a node carries a
  // condition and a condition references a node, so admitting a selector here
  // would deepen that recursion.
  base: VestingNode;
  strict: boolean;
}

/* ------------------------
 * Periodicity
 * ------------------------ */

export interface VestingPeriod<P extends Phase = "normalized"> {
  type: PeriodTag;
  occurrences: number;
  length: number;
  cliff?: P extends "normalized"
    ? VestingNodeExpr | undefined
    : Duration | VestingNodeExpr | undefined;
}

export type RawVestingPeriod = VestingPeriod<"raw">;

/* ------------------------
 * Expressions
 * ------------------------ */

export interface Schedule<P extends Phase = "normalized"> {
  type: "SCHEDULE";
  vesting_start: P extends "normalized"
    ? VestingNodeExpr
    : VestingNodeExpr | null;
  periodicity: VestingPeriod<P>;
}

export type RawSchedule = Schedule<"raw">;

export type LaterOfSchedule<P extends Phase = "normalized"> = Selector<
  ScheduleExpr<P>,
  "SCHEDULE_LATER_OF"
>;

export type EarlierOfSchedule<P extends Phase = "normalized"> = Selector<
  ScheduleExpr<P>,
  "SCHEDULE_EARLIER_OF"
>;

export type ScheduleExpr<P extends Phase = "normalized"> =
  | Schedule<P>
  | LaterOfSchedule<P>
  | EarlierOfSchedule<P>;

export type RawScheduleExpr = ScheduleExpr<"raw">;

/* ------------------------
 * Statements
 * ------------------------ */

interface BaseAmount {
  type: AmountTag;
}
export interface AmountQuantity extends BaseAmount {
  type: "QUANTITY";
  value: number;
}
export interface AmountPortion extends BaseAmount {
  type: "PORTION";
  numerator: number;
  denominator: number;
}
export type Amount = AmountQuantity | AmountPortion;

// A segment written after THEN. It continues the chain from the previous
// segment's end, so it has no start of its own — the null `vesting_start` says
// so, and the resolver fills the handoff date in at evaluation time. It is also
// always a plain schedule, never a selector (a tail can't fan out the way a head
// can), which is why we narrow `Schedule` rather than `ScheduleExpr`.
export interface ChainedSchedule<P extends Phase = "normalized">
  extends Omit<Schedule<P>, "vesting_start"> {
  vesting_start: null;
}

// A statement is either an ordinary one with its own start, or a chained tail.
// Two discriminants do two jobs here. The shared `type: "STATEMENT"` tag lets a
// generic tree walk recognise a statement among all the other node kinds. The
// `chained` flag tells the two statement variants apart, so reading the start of
// a tail without first checking the flag is a type error rather than a runtime
// surprise.
export type Statement<P extends Phase = "normalized"> =
  | {
      type: "STATEMENT";
      chained?: false;
      amount: Amount;
      expr: ScheduleExpr<P>;
    }
  | {
      type: "STATEMENT";
      chained: true;
      amount: Amount;
      expr: ChainedSchedule<P>;
    };

export type RawStatement = Statement<"raw">;

export type Program<P extends Phase = "normalized"> = Statement<P>[];

export type RawProgram = Program<"raw">;
