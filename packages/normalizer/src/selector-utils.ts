import { Selector, SelectorTag, TwoOrMore } from "@vestlang/dsl";

type KeyFn<T> = (item: T) => string;

function sameTag(a: SelectorTag, b: SelectorTag): boolean {
  return a === b;
}

function isSelectorLike<T = unknown>(x: any): x is Selector<T> {
  return (
    x &&
    (x.type === "EarlierOf" || x.type === "LaterOf") &&
    Array.isArray(x.items)
  );
}

/**
 * Flattens nested selectors of the same type:
 * EarlierOf([A, EarlierOf([B,C])]) -> EarlierOf([A, B, C])
 */
function flattenSelector<T>(node: Selector<T>): Selector<T> {
  const out: T[] = [];
  for (const item of node.items) {
    if (isSelectorLike<T>(item) && sameTag(item.type, node.type)) {
      out.push(...(item.items as T[]));
    } else {
      out.push(item);
    }
  }
  return { type: node.type, items: out as TwoOrMore<T> };
}

/**
 * Dedupe selector items by a caller-provided key function.
 * Keeps first occurrence. Does not mutate input
 */
export function dedupeSelector<T>(
  node: Selector<T>,
  keyFn: KeyFn<T>,
): Selector<T> | T {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const item of node.items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  }
  if (items.length === 1) {
    // auto-collapse to the single remaining item
    return items[0]!;
  }

  return { type: node.type, items: items as TwoOrMore<T> };
}

/** flatten, dedupte and auto-collapse if needed */
export function normalizeSelector<T>(
  selector: Selector<T>,
  keyFn: (t: T) => string,
): Selector<T> | T {
  return dedupeSelector(flattenSelector(selector), keyFn);
}
