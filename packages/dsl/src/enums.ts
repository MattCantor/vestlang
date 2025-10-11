/* ------------------------
 * Enums
 * ------------------------ */

// NOTE: enums/TemporalConstraintType.schema.json
export enum ConstraintEnum {
  BEFORE = "BEFORE",
  AFTER = "AFTER",
}

// NOTE: enums/VestingBaseType.schema.json
export enum VBaseEnum {
  DATE = "DATE",
  EVENT = "EVENT",
}

// NOTE: enums/VestingNodeType.schema.json
export const enum VNodeEnum {
  BARE = "BARE",
  CONSTRAINED = "CONSTRAINED",
}

// NOTE: enums/VestlangExpressionType.schema.json
export const enum ExprEnum {
  SINGLETON = "SINGLETON",
  EARLIER_OF = "EARLIER_OF",
  LATER_OF = "LATER_OF",
}

// NOTE: enums/PeriodType.schema.json
// NOTE: existing OCT schema
export const enum PeriodTypeEnum {
  DAYS = "DAYS",
  MONTHS = "MONTHS",
}
