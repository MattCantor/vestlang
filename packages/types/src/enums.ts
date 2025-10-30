// enums/TemporalConstraintType.schema.json
export type ConstraintTag = "BEFORE" | "AFTER";

// enums/VestingBaseType.schema.json
export type VBaseTag = "DATE" | "EVENT";

// enums/VestlangExpressionType.schema.json
export type ExprTag = "SINGLETON" | "EARLIER_OF" | "LATER_OF";

// enums/PeriodType.schema.json
// existing OCT schema
export type PeriodTag = "DAYS" | "MONTHS";

// enums/OffsetType.schema.json
// TODO: add this schema
export type OffsetTag = "PLUS" | "MINUS";

// enums/ConditionType.schema.json
// TODO: add this schema
export type ConditionTag = "ATOM" | "AND" | "OR";

// NOTE: this might have an existing schema
export type AmountTag = "PORTION" | "QUANTITY";
