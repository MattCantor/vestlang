/* ------------------------
 * Enums
 * ------------------------ */

// enums/TemporalConstraintType.schema.json
export enum ConstraintEnum {
  BEFORE = "BEFORE",
  AFTER = "AFTER",
}

// enums/VestingBaseType.schema.json
export enum VBaseEnum {
  DATE = "DATE",
  EVENT = "EVENT",
}

// enums/VestingNodeType.schema.json
export const enum VNodeEnum {
  BARE = "BARE",
  CONSTRAINED = "CONSTRAINED",
}

// enums/VestlangExpressionType.schema.json
export const enum ExprEnum {
  SINGLETON = "SINGLETON",
  EARLIER_OF = "EARLIER_OF",
  LATER_OF = "LATER_OF",
}

// enums/PeriodType.schema.json
// existing OCT schema
export const enum PeriodTypeEnum {
  DAYS = "DAYS",
  MONTHS = "MONTHS",
}

// enums/Offset.schema.json
// TODO: add this schema
export const enum OffsetEnum {
  PLUS = "PLUS",
  MINUS = "MINUS",
}

// NOTE: This might not need a schema
export const enum ConditionTypeEnum {
  ATOM = "ATOM",
  AND = "AND",
  OR = "OR",
}

// NOTE: this might have an existing schema
export const enum AmountTypeEnum {
  PORTION = "PORTION",
  QUANTITY = "QUANTITY",
}
