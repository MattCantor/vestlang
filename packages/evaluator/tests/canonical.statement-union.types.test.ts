// Issue #390 AC1 — `OCFVestingStatement` is a union that makes the neither-corner
// (a statement with neither `schedule` nor `event_condition`) unrepresentable, and
// keeps `cliff` reachable only at `statement.schedule.cliff`, never top-level.
//
// The `@ts-expect-error` lines are the assertions: if the type ever regresses to a
// shape that admits the illegal combinations, the directives go unused and the root
// `typecheck` (`tsc --noEmit -p tsconfig.lint.json`, which includes the test files)
// fails. The valid fixtures compile on their own, so a typo can't make the whole
// test pass vacuously. The body never executes — these are type-level checks.

import { describe, it, expect } from "vitest";
import type { OCFVestingStatement } from "@vestlang/types";

describe("OCFVestingStatement union (AC1)", () => {
  it("rejects a statement with neither schedule nor event_condition", () => {
    // @ts-expect-error — the neither-corner is unrepresentable: a statement must
    // carry a `schedule`, an `event_condition`, or both. The error lands on the
    // whole literal (it matches neither union arm), so the directive sits here.
    const bad: OCFVestingStatement = {
      order: 1,
      percentage: "1",
    };
    expect(bad).toBeDefined();
  });

  it("rejects a top-level cliff (cliff lives inside schedule)", () => {
    const bad: OCFVestingStatement = {
      order: 1,
      percentage: "1",
      schedule: { occurrences: 1, period: 0, period_type: "DAYS" },
      // @ts-expect-error — `cliff` is reachable only at `schedule.cliff`, never
      // top-level on the statement.
      cliff: { length: 12, period_type: "MONTHS", percentage: "0.25" },
    };
    expect(bad).toBeDefined();
  });

  it("admits a pure milestone (event_condition, no schedule)", () => {
    const milestone: OCFVestingStatement = {
      order: 1,
      percentage: "1",
      event_condition: { event_id: "ipo" },
    };
    expect(milestone).toBeDefined();
  });

  it("admits a scheduled statement, with and without an event_condition", () => {
    const dated: OCFVestingStatement = {
      order: 1,
      percentage: "1",
      schedule: {
        occurrences: 48,
        period: 1,
        period_type: "MONTHS",
        cliff: { length: 12, period_type: "MONTHS", percentage: "0.25" },
      },
    };
    const hybrid: OCFVestingStatement = {
      order: 1,
      percentage: "1",
      schedule: { occurrences: 48, period: 1, period_type: "MONTHS" },
      event_condition: { event_id: "ipo" },
    };
    expect([dated, hybrid]).toHaveLength(2);
  });

  it("reads cliff through schedule once narrowed on schedule presence", () => {
    const s: OCFVestingStatement = {
      order: 1,
      percentage: "1",
      schedule: {
        occurrences: 48,
        period: 1,
        period_type: "MONTHS",
        cliff: { length: 12, period_type: "MONTHS", percentage: "0.25" },
      },
    };
    // `schedule.cliff` is the only path to the cliff, and only after narrowing on
    // `schedule` presence (the milestone arm has no such key); this compiles, the
    // top-level read above does not.
    expect("schedule" in s ? s.schedule.cliff?.length : undefined).toBe(12);
  });
});
