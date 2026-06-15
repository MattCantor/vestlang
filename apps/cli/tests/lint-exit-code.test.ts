import { lintText, lintMarkdown } from "@vestlang/linter";
import { describe, expect, it } from "vitest";
import { exitCode } from "../src/lint.js";

// Warning-only program: a `portion-allocation` under-allocation warning, no error.
const WARNING_DSL = "1/2 VEST OVER 12 months EVERY 1 month";
// `unsatisfiable-date-window` error: the AFTER date is later than the BEFORE date.
const ERROR_DSL =
  "VEST FROM EVENT x AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 48 months EVERY 1 month";

// A fenced ```vest block is what lintMarkdown scans; wrap a DSL line in one.
const vestBlock = (dsl: string): string => "```vest\n" + dsl + "\n```\n";

describe("exitCode", () => {
  it("returns 0 for no diagnostics", () => {
    expect(exitCode([])).toBe(0);
  });

  it("returns 0 when only warnings are present", () => {
    expect(exitCode([{ severity: "warning" }])).toBe(0);
  });

  it("returns 1 for an error", () => {
    expect(exitCode([{ severity: "error" }])).toBe(1);
  });

  it("returns 1 when an error sits alongside a warning", () => {
    expect(exitCode([{ severity: "warning" }, { severity: "error" }])).toBe(1);
  });
});

describe("text path (lintText)", () => {
  it("exits 0 for a warning-only program (the reported repro)", () => {
    expect(exitCode(lintText(WARNING_DSL).diagnostics)).toBe(0);
  });

  it("exits 1 for an unsatisfiable-date-window error", () => {
    expect(exitCode(lintText(ERROR_DSL).diagnostics)).toBe(1);
  });
});

describe("markdown path (lintMarkdown)", () => {
  it("exits 0 for a warning-only ```vest block", () => {
    expect(exitCode(lintMarkdown(vestBlock(WARNING_DSL)))).toBe(0);
  });

  it("exits 1 for an error ```vest block", () => {
    expect(exitCode(lintMarkdown(vestBlock(ERROR_DSL)))).toBe(1);
  });
});
