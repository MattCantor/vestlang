import type { PipelineError } from "@vestlang/pipeline";
import { afterEach, describe, expect, it } from "vitest";
import { fail } from "../src/utils.js";
import { spyConsoleAndExit, type Spies } from "./harness.js";

// fail() appends a `(line:col)` suffix only for a located syntax-error; every
// other error (and a location-less syntax-error) gets the bare message. Construct
// the PipelineError values directly so the test pins the suffix rule itself rather
// than depending on which DSL the parser happens to locate.

// A syntax-error carrying a source span.
const LOCATED: PipelineError = {
  ruleId: "syntax-error",
  message: "unexpected token",
  loc: {
    start: { line: 3, column: 7 },
    end: { line: 3, column: 9 },
  },
};

// An evaluation-error — the loc-less arm of the union, so no suffix.
const SUFFIXLESS: PipelineError = {
  ruleId: "evaluation-error",
  message: "installment cap exceeded",
};

describe("fail() error contract", () => {
  let spies: Spies;
  afterEach(() => spies?.restore());

  it("a located syntax-error emits exactly one `error: <message> (line:col)` and exits 1", () => {
    spies = spyConsoleAndExit();
    expect(() => fail(LOCATED)).toThrow(/__exit__:1/);
    expect(spies.exitCode()).toBe(1);

    // Exactly one stderr line, with the suffix from the loc's start position.
    const calls = spies.error.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("error: unexpected token (3:7)");
    // No raw Node stack trace leaking through.
    expect(spies.stderr()).not.toMatch(/\bat\s+\w+.*\(.*:\d+:\d+\)/);
  });

  it("a suffix-less error emits `error: <message>` with no suffix and exits 1", () => {
    spies = spyConsoleAndExit();
    expect(() => fail(SUFFIXLESS)).toThrow(/__exit__:1/);
    expect(spies.exitCode()).toBe(1);

    const calls = spies.error.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("error: installment cap exceeded");
    // No trailing (line:col).
    expect(calls[0][0]).not.toMatch(/\(\d+:\d+\)$/);
  });

  it("a location-less syntax-error gets no suffix either", () => {
    spies = spyConsoleAndExit();
    const noLoc: PipelineError = {
      ruleId: "syntax-error",
      message: "unterminated input",
    };
    expect(() => fail(noLoc)).toThrow(/__exit__:1/);
    expect(spies.error.mock.calls[0][0]).toBe("error: unterminated input");
  });
});
