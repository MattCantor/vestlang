// `toParseError` is the dsl-owned, total classifier for what `parse` throws. A
// located peggy syntax error classifies to `{ message, loc }`; anything else
// (a non-peggy Error, a bare global SyntaxError, a non-Error value) classifies
// to a position-less `{ message }`, so `loc` is the discriminator the consumers
// branch on.

import { describe, it, expect } from "vitest";
import { parse, toParseError } from "../src/index";

const caught = (src: string): unknown => {
  try {
    parse(src);
  } catch (e) {
    return e;
  }
  throw new Error(`expected parse to throw for: ${src}`);
};

describe("toParseError", () => {
  it("classifies a real peggy throw with a located span", () => {
    const r = toParseError(caught("garbage"));
    expect(r.loc).toBeDefined();
    // Assert structure + numeric type, not exact coordinates (robust to a peggy
    // upgrade), matching the parse.spec.ts pattern.
    expect(typeof r.message).toBe("string");
    expect(typeof r.loc?.start.line).toBe("number");
    expect(typeof r.loc?.start.column).toBe("number");
    expect(typeof r.loc?.end.line).toBe("number");
    expect(typeof r.loc?.end.column).toBe("number");
  });

  it("classifies a non-peggy Error as position-less, keeping its message", () => {
    const r = toParseError(new Error("x"));
    expect(r.loc).toBeUndefined();
    expect(r.message).toBe("x");
  });

  it("classifies a bare global SyntaxError (no .location) as position-less", () => {
    const r = toParseError(new SyntaxError("y"));
    expect(r.loc).toBeUndefined();
    expect(r.message).toBe("y");
  });

  it("classifies a non-Error throw via String(err)", () => {
    const r = toParseError("boom");
    expect(r.loc).toBeUndefined();
    expect(r.message).toBe("boom");
  });
});
