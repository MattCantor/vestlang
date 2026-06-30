// enums/TemporalConstraintType.schema.json
export type ConstraintTag = "BEFORE" | "AFTER";

// enums/VestingBaseType.schema.json
export type VBaseTag = "DATE" | "EVENT" | "GRANT_DATE" | "VESTING_START";

// enums/VestlangExpressionType.schema.json
//
// The `type` tags an expression node can carry. There are two parallel families
// — one for schedule-level expressions, one for vesting-node-level expressions —
// and they are kept distinct on purpose: a single value can tell you both the
// shape of a node and which layer it belongs to, so one tree walk can dispatch
// on `type` alone without ever confusing a schedule with a node.
export type ScheduleExprTag =
  | "SCHEDULE"
  | "SCHEDULE_EARLIER_OF"
  | "SCHEDULE_LATER_OF";

export type NodeExprTag = "NODE" | "NODE_EARLIER_OF" | "NODE_LATER_OF";

export type ExprTag = ScheduleExprTag | NodeExprTag;

// enums/OCFPeriodType.schema.json
// existing OCT schema
//
// The DSL's period unit. Deliberately only DAYS and MONTHS: vestlang source has
// no YEARS unit, since a "1 year cliff" is written as 12 months. This is distinct
// from `OCFPeriodType` in ./canonical.ts, the OCF/Carta interchange unit, which
// does include YEARS. The two are intentionally different; don't unify them.
export type PeriodTag = "DAYS" | "MONTHS";

// enums/OffsetType.schema.json
export type OffsetTag = "PLUS" | "MINUS";

// enums/ConditionType.schema.json
export type ConditionTag = "ATOM" | "AND" | "OR";

export type AmountTag = "PORTION" | "QUANTITY";
