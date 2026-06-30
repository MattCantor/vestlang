// #431 (AC1 / AC6) — the structural verdict is structurally unusable as an
// allocatability claim. The structural result has NO `valid` field: a careless
// consumer can't read shape-validity as "safe to allocate." The type-level
// guards below are checked by `tsc -p tsconfig.lint.json` (the root `typecheck`,
// which pulls in `tests`); the runtime guard runs under vitest.
//
// The expect-error directive on the `.valid` read is the load-bearing assertion —
// if the structural result type ever regrew a `valid` field, the directive goes
// unused and the build fails. The paired positive `toHaveProperty` assertions stop
// the directive from false-passing if the result type silently collapsed to
// `any` / `never` (on which `.valid` would type-check trivially).

import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateVestingScheduleTemplate,
  validateVestingRuntime,
  validateTemplateAllocatable,
} from "../src/validate";
import type { VestingRuntime } from "@vestlang/types";
import { mkTemplate } from "./helpers";

// Two 0.75 statements sum to 150% — structurally well-formed, over-allocating.
const template = mkTemplate("alloc", [
  {
    order: 1,
    schedule: { occurrences: 1, period: 12, period_type: "MONTHS" },
    percentage: "0.75",
  },
  {
    order: 2,
    schedule: { occurrences: 1, period: 12, period_type: "MONTHS" },
    percentage: "0.75",
  },
]);

const runtime: VestingRuntime = { startDate: "2024-01-01" };

describe("structural verdict has no `valid` field (#431 AC1/AC6)", () => {
  it("exposes structurallyValid + allocation, not valid (type-level)", () => {
    const result = validateVestingScheduleTemplate(template);

    // Positive: the new fields exist on the structural result type. These also
    // prove the type didn't degrade to `any`/`never` (which would make the
    // expect-error directive below false-pass).
    expectTypeOf(result).toHaveProperty("structurallyValid");
    expectTypeOf(result).toHaveProperty("allocation");
    expectTypeOf(result.structurallyValid).toEqualTypeOf<boolean>();
    expectTypeOf(result.allocation).toEqualTypeOf<"not-checked">();

    // The hazard is gone: reading `valid` off the structural result no longer
    // type-checks. (If this ever compiled, the directive would be unused and CI
    // would fail.)
    // @ts-expect-error — the structural verdict deliberately carries no `valid`
    void result.valid;
  });

  it("carries no `valid` property at runtime — only structurallyValid", () => {
    const result = validateVestingScheduleTemplate(template);
    expect(result).not.toHaveProperty("valid");
    expect(result).toHaveProperty("structurallyValid");
    expect(result.allocation).toBe("not-checked");
  });

  it("the runtime and allocatable verdicts KEEP their (distinct) `valid`", () => {
    // Runtime `valid` is the legitimate "inputs ok?" predicate — never overloaded
    // with allocatability, so it stays a real field.
    const runtimeResult = validateVestingRuntime(runtime, template);
    expectTypeOf(runtimeResult.valid).toEqualTypeOf<boolean>();
    expect(runtimeResult).toHaveProperty("valid");

    // The allocatable checker's `valid` is the one that DOES mean "safe to
    // allocate" — it survives, finding-derived.
    const allocResult = validateTemplateAllocatable(template, 4800);
    expectTypeOf(allocResult.valid).toEqualTypeOf<boolean>();
    expect(allocResult).toHaveProperty("valid");
  });
});
