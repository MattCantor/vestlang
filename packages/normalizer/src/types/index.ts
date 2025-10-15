import { EarlierOf, LaterOf, TwoOrMore, VNodeTag } from "@vestlang/dsl";

/* ------------------------
 * Normalizer Invariants
 * ------------------------
 * - Offsets: summed by unit, zeros dropped ⇒ at most one MONTHS and at most one DAYS entry.
 * - Selectors: children normalized; same-op flattened; items sorted & deduped; singletons collapsed.
 * - Conditions: only ATOM/AND/OR; flattened; sorted & deduped; singletons collapsed.
 *   Critically: no ATOM has a CONSTRAINED base (base is always BARE after hoisting).
 */

/* ------------------------
 * Durations
 * ------------------------ */

import { Duration } from "@vestlang/dsl";
export { Duration } from "@vestlang/dsl";

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
  | []
  | [DurationMonth | DurationDay]
  | [DurationMonth, DurationDay];

/* ------------------------
 * Vesting Base
 * ------------------------ */

import { VestingBaseDate, VestingBaseEvent } from "@vestlang/dsl";
export { VestingBaseDate, VestingBaseEvent } from "@vestlang/dsl";

/* ------------------------
 * Vesting Node
 * ------------------------ */

// primitives/types/vestlang/VestingNode.schema.json
export interface VestingNode {
  type: VNodeTag;
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Offsets;
}

export interface BareVestingNode extends VestingNode {
  type: "BARE";
}

export interface ConstrainedVestingNode extends VestingNode {
  type: "CONSTRAINED";
  constraints: Condition;
}

/* ------------------------
 * Conditions & Constraints
 * ------------------------ */

import { BaseCondition, ConstraintTag } from "@vestlang/dsl";
export { BaseCondition, ConstraintTag } from "@vestlang/dsl";

// TODO: add to schema
export interface AtomCondition extends BaseCondition {
  type: "ATOM";
  constraint: Constraint;
}

export interface NormalizedAtomCondition extends BaseCondition {
  type: "ATOM";
  constraint: Omit<Constraint, "base"> & { base: BareVestingNode };
}

// TODO: add to schema
export interface AndCondition extends BaseCondition {
  type: "AND";
  items: TwoOrMore<Condition>;
}

export interface NormalizedAndCondition extends BaseCondition {
  type: "AND";
  items: TwoOrMore<NormalizedCondition>;
}

// TODO: add to schema
export interface OrCondition extends BaseCondition {
  type: "OR";
  items: TwoOrMore<Condition>;
}

export interface NormalizedOrCondition extends BaseCondition {
  type: "OR";
  items: TwoOrMore<NormalizedCondition>;
}

export type Condition = AtomCondition | AndCondition | OrCondition;
export type NormalizedCondition =
  | NormalizedAtomCondition
  | NormalizedAndCondition
  | NormalizedOrCondition;

// TODO: add to schema
export interface Constraint {
  type: ConstraintTag;
  base: VestingNode;
  strict: boolean;
}

/* ------------------------
 * Periodicity
 * ------------------------ */

import { PeriodTag } from "@vestlang/dsl";

export interface VestingPeriod {
  type: PeriodTag;
  occurrences: number;
  length: number;
  cliff?: VestingNode | LaterOfVestingNode | EarlierOfVestingNode;
}

/* ------------------------
 * Expressions
 * ------------------------ */

// TODO: add to schmea
export type LaterOfVestingNode = LaterOf<VestingNode>;
export type EarlierOfVestingNode = EarlierOf<VestingNode>;

// TODO: add to schema
export interface Schedule {
  type: "SINGLETON";
  vesting_start: VestingNode | LaterOfVestingNode | EarlierOfVestingNode;
  periodicity: VestingPeriod;
}

// TODO: add to schema
export type LaterOfSchedule = LaterOf<Schedule>;
export type EarlierOfSchedule = EarlierOf<Schedule>;

/* ------------------------
 * Statements
 * ------------------------ */

import { Amount } from "@vestlang/dsl";
export { Amount } from "@vestlang/dsl";

// TODO: add to schema
export interface Statement {
  amount: Amount;
  expr: Schedule | LaterOfSchedule | EarlierOfSchedule;
}

export type Program = Statement[];
