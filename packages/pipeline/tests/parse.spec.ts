import { describe, it, expect } from "vitest";
import { parseToProgram, parseRaw, toPipelineError } from "../src/parse";

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
  it("carries loc when the thrown error has a location", () => {
    const err = {
      name: "SyntaxError",
      message: "boom",
      location: {
        start: { line: 1, column: 3 },
        end: { line: 1, column: 4 },
      },
    };
    const mapped = toPipelineError(err);
    expect(mapped.ruleId).toBe("syntax-error");
    if (mapped.ruleId === "syntax-error") {
      expect(mapped.message).toBe("boom");
      expect(mapped.loc?.start.column).toBe(3);
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
});
