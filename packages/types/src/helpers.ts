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
declare const __isoDateBrand: unique symbol;
export type OCTDate = string & { [__isoDateBrand]: never };
