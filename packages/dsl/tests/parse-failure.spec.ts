// `asParseFailure` is the dsl-owned decoder for what `parse` throws. It turns a
// real peggy syntax error into a structured `{ message, loc }`, and returns
// `undefined` for anything else — which is what selects each consumer's fallback
// arm. `ParseFailure` is imported by name so knip sees the type used.

import { describe, it, expect } from "vitest";
import { parse, asParseFailure, type ParseFailure } from "../src/index";

const caught = (src: string): unknown => {
  try {
    parse(src);
  } catch (e) {
    return e;
  }
  throw new Error(`expected parse to throw for: ${src}`);
};

describe("asParseFailure", () => {
  it("decodes a real peggy throw into a located ParseFailure", () => {
    const failure: ParseFailure | undefined = asParseFailure(caught("garbage"));
    expect(failure).toBeDefined();
    // Assert structure + numeric type, not exact coordinates (robust to a peggy
    // upgrade), matching the parse.spec.ts pattern.
    expect(typeof failure?.message).toBe("string");
    expect(typeof failure?.loc.start.line).toBe("number");
    expect(typeof failure?.loc.start.column).toBe("number");
    expect(typeof failure?.loc.end.line).toBe("number");
    expect(typeof failure?.loc.end.column).toBe("number");
  });

  it("returns undefined for a non-peggy Error", () => {
    expect(asParseFailure(new Error("x"))).toBeUndefined();
  });

  it("returns undefined for a bare global SyntaxError (no .location)", () => {
    expect(asParseFailure(new SyntaxError("x"))).toBeUndefined();
  });
});
