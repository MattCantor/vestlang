import { describe, expect, it } from "vitest";
import { normalizeProgram, parse } from "@vestlang/vestlang";
import {
  formatAuthoringFeedback,
  validateVestlang,
  VESTLANG_AUTHORING_PROMPT,
} from "@vestlang/vestlang/authoring";

// A statement that lints clean but trips the month-end advisory; one that trips
// the cliff-span warning; one that over-allocates (a blocking rule, not syntax).
const MONTH_END_START =
  "VEST FROM DATE 2025-06-30 OVER 12 months EVERY 1 month";
const LONG_CLIFF = "VEST OVER 12 months EVERY 1 month CLIFF 24 months";
const OVER_ALLOCATED =
  "0.5 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 3 months" +
  " PLUS 0.75 VEST FROM DATE 2026-01-01 OVER 12 months EVERY 3 months";

describe("validateVestlang", () => {
  it("returns the normalized program for a valid statement", () => {
    const dsl = "VEST OVER 48 months EVERY 1 month CLIFF 12 months";
    const result = validateVestlang(dsl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program).toEqual(normalizeProgram(parse(dsl)));
    expect(result.warnings).toEqual([]);
  });

  it("accepts a multi-statement program", () => {
    const dsl =
      "0.5 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 3 months" +
      " PLUS 0.5 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 3 months";
    const result = validateVestlang(dsl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program).toHaveLength(2);
  });

  // Empty source is not special-cased anywhere: the parser refuses it like any
  // other unparseable text, so the fault the caller sees is always a real one.
  it.each(["vest whenever it feels right", ""])(
    "reports unparseable source as a syntax error rather than throwing: %j",
    (source) => {
      const result = validateVestlang(source);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics.map((d) => d.ruleId)).toContain("syntax-error");
    },
  );

  it("blocks on a statement that parses but trips an error-severity rule", () => {
    const result = validateVestlang(OVER_ALLOCATED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.ruleId)).toContain(
      "portion-allocation",
    );
    expect(result.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("surfaces a warning-severity diagnostic without blocking", () => {
    const result = validateVestlang(LONG_CLIFF);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((d) => d.ruleId)).toContain(
      "cliff-exceeds-span",
    );
  });

  // `warnings` is the complement of the blocking set, not the warning severity —
  // an info diagnostic has to ride along too.
  it("surfaces an info-severity diagnostic without blocking", () => {
    const result = validateVestlang(MONTH_END_START);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((d) => d.ruleId)).toContain(
      "ambiguous-month-end-start",
    );
    expect(result.warnings.some((d) => d.severity === "info")).toBe(true);
  });
});

describe("formatAuthoringFeedback", () => {
  it("echoes the text that was validated and names every blocking fault", () => {
    const result = validateVestlang(OVER_ALLOCATED);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const feedback = formatAuthoringFeedback(
      OVER_ALLOCATED,
      result.diagnostics,
    );
    expect(feedback).toContain(OVER_ALLOCATED);
    for (const diagnostic of result.diagnostics) {
      expect(feedback).toContain(diagnostic.message);
    }
  });

  it("leaves advisory diagnostics out of the corrective turn", () => {
    // The long cliff on its own is only a warning; alongside a sibling that
    // over-allocates the grant, the program is blocked. Only the blocking half
    // is what the model gets told about.
    const dsl =
      `0.5 ${LONG_CLIFF}` +
      " PLUS 0.75 VEST FROM DATE 2026-01-01 OVER 12 months EVERY 1 month";
    const result = validateVestlang(dsl);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const cliffWarning = validateVestlang(LONG_CLIFF);
    expect(cliffWarning.ok).toBe(true);
    if (!cliffWarning.ok) return;

    const feedback = formatAuthoringFeedback(dsl, result.diagnostics);
    for (const warning of cliffWarning.warnings) {
      expect(feedback).not.toContain(warning.message);
    }
  });
});

describe("the shipped authoring prompt", () => {
  const examples = [
    ...VESTLANG_AUTHORING_PROMPT.matchAll(/```vest\r?\n([\s\S]*?)```/g),
  ].map((m) => m[1]);

  it("carries worked DSL examples", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)("teaches a valid program: %s", (example) => {
    const result = validateVestlang(example);
    const faults = result.ok
      ? ""
      : result.diagnostics.map((d) => d.message).join("; ");
    expect(faults, example).toBe("");
  });
});
