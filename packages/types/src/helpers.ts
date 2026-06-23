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

// types/Numeric.schema.json
// existing OCT schema
//
// A fixed-point decimal string — optional sign, integer part, up to ten
// fractional digits, no scientific notation. This is OCF's `Numeric`, NOT
// Carta's `{ value }` object. The interchange stores a vesting percentage in
// this shape rather than as an exact rational, which is why a repeating share
// (a 1/3 cliff) can only be written truncated. Like OCTDate this is a plain
// `string` alias with no brand — validated at the read/write boundaries via
// `isNumeric` / `validateNumeric` (in @vestlang/utils).
export type Numeric = string;

// The one source of truth for the OCF `Numeric` grammar. Everything that has to
// agree on the shape — the boundary validator, the persist zod schema, the
// parse/render helpers, the precision analyzer — references this single regex
// (as a string so a zod `.regex()` and a fresh `RegExp` can both consume it).
export const NUMERIC_PATTERN_SOURCE = "^[+-]?[0-9]+(\\.[0-9]{1,10})?$";

// The same grammar as a ready-to-use RegExp.
export const NUMERIC_PATTERN: RegExp = new RegExp(NUMERIC_PATTERN_SOURCE);
