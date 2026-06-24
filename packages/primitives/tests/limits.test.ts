import { describe, it, expect } from "vitest";
import { MAX_INSTALLMENTS, installmentCapMessage } from "../src/limits";

describe("installmentCapMessage", () => {
  // The single spelling of the over-cap error, shared by the template validator,
  // the evaluator's pre-expansion guard, and the linter. Pin its shape so the
  // three callers can't drift apart, and so it keeps quoting the real limit.
  it("names the offending total and the shared MAX_INSTALLMENTS limit", () => {
    expect(installmentCapMessage(12_345)).toBe(
      `schedule expands to 12345 installments, exceeds the limit of ${MAX_INSTALLMENTS}`,
    );
  });
});
