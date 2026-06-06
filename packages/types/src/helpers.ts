export type TwoOrMore<T> = [T, T, ...T[]];

// Which way a resolved "pick one of these" choice went. This is a property of a
// computed result — "the EARLIER OF the two dates won" — not the structural kind
// of a syntax-tree node. Node kinds are tagged separately (see enums.ts), and
// the two must not be conflated: this value flows into evaluator output and
// blocker messages, where the words EARLIER/LATER carry meaning to the reader.
export type SelectorTag = "EARLIER_OF" | "LATER_OF";

// A "pick one of these" node: a list of two-or-more candidates of the same kind.
// The tag is left free so each place that uses a selector can stamp its own,
// distinct node kind — a schedule-level selector and a node-level one share this
// shape but must be told apart by their `type`.
export interface Selector<T, K extends string = string> {
  type: K;
  items: TwoOrMore<T>;
}

// types/Date.schema.json
// existing OCT schema
//
// A plain string alias (ISO 8601 YYYY-MM-DD). The name documents intent in
// signatures; it carries no nominal brand today. Reconsidering a real brand +
// a validating mint is tracked as a vestlang issue.
export type OCTDate = string;
