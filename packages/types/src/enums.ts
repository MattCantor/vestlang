// enums/TemporalConstraintType.schema.json
export type ConstraintTag = "BEFORE" | "AFTER";

// enums/VestingBaseType.schema.json
export type VBaseTag = "DATE" | "EVENT";

// enums/VestlangExpressionType.schema.json
export type ExprTag = "SINGLETON" | "EARLIER_OF" | "LATER_OF";

// enums/PeriodType.schema.json
// existing OCT schema
//
// The DSL's period unit. Deliberately only DAYS and MONTHS: vestlang source has
// no YEARS unit, since a "1 year cliff" is written as 12 months. This is distinct
// from `PeriodType` in ./canonical.ts, the OCF/Carta interchange unit, which does
// include YEARS. The two are intentionally different; don't unify them.
export type PeriodTag = "DAYS" | "MONTHS";

// enums/OffsetType.schema.json
export type OffsetTag = "PLUS" | "MINUS";

// enums/ConditionType.schema.json
export type ConditionTag = "ATOM" | "AND" | "OR";

export type AmountTag = "PORTION" | "QUANTITY";
