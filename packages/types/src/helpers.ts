export type TwoOrMore<T> = [T, T, ...T[]];

export type SelectorTag = "EARLIER_OF" | "LATER_OF";

interface Selector<T, K extends SelectorTag = SelectorTag> {
  type: K;
  items: TwoOrMore<T>;
}

export interface EarlierOf<T> extends Selector<T, "EARLIER_OF"> {}

export interface LaterOf<T> extends Selector<T, "LATER_OF"> {}

// types/Date.schema.json
// existing OCT schema
//
// A plain string alias (ISO 8601 YYYY-MM-DD). The name documents intent in
// signatures; it carries no nominal brand today. Reconsidering a real brand +
// a validating mint is tracked as a vestlang issue.
export type OCTDate = string;
