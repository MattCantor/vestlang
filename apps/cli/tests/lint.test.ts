import { afterEach, describe, expect, it } from "vitest";
import { lint } from "../src/lint.js";
import { spyConsoleAndExit, type Spies } from "./harness.js";

// Clean program: parses and lints with no diagnostics.
const CLEAN_DSL = "VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";
// Warning-only: under-allocation (`portion-allocation`), no error-severity diagnostic.
const WARNING_DSL = "1/2 VEST OVER 12 months EVERY 1 month";
// Error: AFTER date later than BEFORE date (`unsatisfiable-date-window`).
const ERROR_DSL =
  "VEST FROM EVENT x AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 48 months EVERY 1 month";

// Unlike the other four actions, lint() calls process.exit on EVERY path —
// including the clean one (exit 0) — so each test catches the sentinel and reads
// the recorded code rather than asserting a normal return.
describe("lint action (text mode)", () => {
  let spies: Spies;
  afterEach(() => spies?.restore());

  it('a clean program prints "No problems found." and exits 0', () => {
    spies = spyConsoleAndExit();
    expect(() => lint([CLEAN_DSL], {})).toThrow(/__exit__:0/);
    expect(spies.stdout()).toContain("No problems found.");
    expect(spies.exitCode()).toBe(0);
  });

  it("a warning-only program exits 0 and prints a diagnostic", () => {
    spies = spyConsoleAndExit();
    expect(() => lint([WARNING_DSL], {})).toThrow(/__exit__:0/);
    expect(spies.stdout()).toContain("warning:");
    expect(spies.exitCode()).toBe(0);
  });

  it("an error program prints an error diagnostic and exits 1", () => {
    spies = spyConsoleAndExit();
    expect(() => lint([ERROR_DSL], {})).toThrow(/__exit__:1/);
    expect(spies.stdout()).toContain("error:");
    expect(spies.exitCode()).toBe(1);
  });
});
