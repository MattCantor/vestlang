import { describe, it, expect } from "vitest";
import { stableKey } from "../src/stable-key";

// A deterministic dedupe key: object keys are recursively sorted so content
// equality survives key-order differences, and a cycle guard keeps a
// self-referential value from blowing the stack. The linter and the normalizer
// both key on this and have to agree byte-for-byte.
describe("stableKey", () => {
  it("is independent of object key order", () => {
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }));
  });

  it("distinguishes different content", () => {
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
  });

  it("preserves array order — arrays are not key-sorted", () => {
    expect(stableKey([1, 2, 3])).not.toBe(stableKey([3, 2, 1]));
  });

  it("serializes an array as a JSON array, not an index-keyed object", () => {
    expect(stableKey([1, 2, 3])).toBe("[1,2,3]");
  });

  it("sorts keys at every nesting level", () => {
    expect(stableKey({ x: { a: 1, b: 2 } })).toBe(
      stableKey({ x: { b: 2, a: 1 } }),
    );
  });

  it("stringifies primitives and null directly", () => {
    expect(stableKey(5)).toBe("5");
    expect(stableKey("s")).toBe('"s"');
    expect(stableKey(null)).toBe("null");
  });

  it("guards against cycles instead of recursing forever", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => stableKey(a)).not.toThrow();
    expect(stableKey(a)).toContain("[Circular]");
  });
});
