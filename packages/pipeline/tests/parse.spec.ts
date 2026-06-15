import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { parseToProgram, parseRaw, toPipelineError } from "../src/parse";

// A real thrown peggy syntax error, the only thing the decoder treats as located.
const caughtParseError = (src: string): unknown => {
  try {
    parse(src);
  } catch (e) {
    return e;
  }
  throw new Error(`expected parse to throw for: ${src}`);
};

describe("parseToProgram", () => {
  it("returns the normalized program for valid DSL", () => {
    const r = parseToProgram("VEST OVER 48 months EVERY 1 month");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.program).toHaveLength(1);
  });

  it("returns a located syntax error for garbage", () => {
    const r = parseToProgram("this is not vestlang");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.ruleId).toBe("syntax-error");
      if (r.error.ruleId === "syntax-error") {
        expect(r.error.loc).toBeDefined();
        expect(typeof r.error.loc?.start.line).toBe("number");
      }
    }
  });
});

describe("parseRaw", () => {
  it("returns the raw AST without normalizing", () => {
    const r = parseRaw("VEST OVER 48 months EVERY 1 month");
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.isArray(r.ast)).toBe(true);
  });
});

describe("toPipelineError", () => {
  it("carries loc when the thrown error is a located peggy error", () => {
    const mapped = toPipelineError(caughtParseError("this is not vestlang"));
    expect(mapped.ruleId).toBe("syntax-error");
    if (mapped.ruleId === "syntax-error") {
      expect(typeof mapped.message).toBe("string");
      expect(typeof mapped.loc?.start.column).toBe("number");
      expect(typeof mapped.loc?.start.line).toBe("number");
    }
  });

  it("falls back to a loc-less syntax error otherwise", () => {
    const mapped = toPipelineError(new Error("no location here"));
    expect(mapped.ruleId).toBe("syntax-error");
    if (mapped.ruleId === "syntax-error") {
      expect(mapped.message).toBe("no location here");
      expect(mapped.loc).toBeUndefined();
    }
  });

  it("falls back to a loc-less syntax error for a bare global SyntaxError", () => {
    const mapped = toPipelineError(new SyntaxError("bare"));
    expect(mapped.ruleId).toBe("syntax-error");
    if (mapped.ruleId === "syntax-error") {
      expect(mapped.message).toBe("bare");
      expect(mapped.loc).toBeUndefined();
    }
  });
});
