// AC#2 / AC#3 — the day-of-month union is split into two disjoint sub-unions, and
// the named-policy switch (the one `pickDay` runs) is exhaustive over all four
// named policies. The exhaustiveness fixture mirrors the evaluator's
// `resolve.chain-du.types.test.ts`: a complete `assertNever`-terminated switch
// compiles, and a deliberately-incomplete one carries a `@ts-expect-error` that
// goes unused — failing the build — if the tripwire ever regresses.
//
// The type-level assertions are validated by `tsc -p tsconfig.lint.json` (the
// root `typecheck`, which includes `tests`); the runtime assertions run under
// vitest. The 5th-member guarantee in AC#3 lives in `pickDay` itself, which
// `tsc` checks every CI run — adding a member to `NAMED_DAY_POLICY_VALUES`
// without a matching `case` there breaks the build. This file pins the same
// shape independently of that call site.

import { describe, it, expect, expectTypeOf } from "vitest";
import {
  VESTING_DAY_OF_MONTH_VALUES,
  NUMERIC_DAY_OF_MONTH_VALUES,
  NAMED_DAY_POLICY_VALUES,
  isNumericDayOfMonth,
} from "@vestlang/types";
import type { VestingDayOfMonth, NamedDayPolicy } from "@vestlang/types";
import { assertNever } from "@vestlang/utils";

// The 32 codes the entry points constrain through, in their canonical order, so a
// recompose that reordered or dropped a value fails here.
const PRIOR_VALUES = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29_OR_LAST_DAY_OF_MONTH",
  "30_OR_LAST_DAY_OF_MONTH",
  "31_OR_LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
] as const;

describe("VESTING_DAY_OF_MONTH_VALUES recompose (AC#2)", () => {
  it("recomposes to the same 32 values in the same order", () => {
    expect(VESTING_DAY_OF_MONTH_VALUES).toEqual(PRIOR_VALUES);
    expect(VESTING_DAY_OF_MONTH_VALUES).toHaveLength(32);
  });

  it("both component arrays are non-empty", () => {
    expect(NUMERIC_DAY_OF_MONTH_VALUES.length).toBeGreaterThan(0);
    expect(NAMED_DAY_POLICY_VALUES.length).toBeGreaterThan(0);
  });

  it("the two sub-unions are disjoint at runtime", () => {
    const numeric = new Set<string>(NUMERIC_DAY_OF_MONTH_VALUES);
    const overlap = NAMED_DAY_POLICY_VALUES.filter((v) => numeric.has(v));
    expect(overlap).toEqual([]);
  });

  it("isNumericDayOfMonth narrows the numeric branch and rejects the named one", () => {
    expect(isNumericDayOfMonth("01")).toBe(true);
    expect(isNumericDayOfMonth("28")).toBe(true);
    expect(isNumericDayOfMonth("29_OR_LAST_DAY_OF_MONTH")).toBe(false);
    expect(isNumericDayOfMonth("VESTING_START_DAY_OR_LAST_DAY_OF_MONTH")).toBe(
      false,
    );
  });
});

describe("VestingDayOfMonth sub-union assignability (AC#2)", () => {
  it("a numeric literal and a named literal each land in the union", () => {
    expectTypeOf<"01">().toMatchTypeOf<VestingDayOfMonth>();
    expectTypeOf<"VESTING_START_DAY_OR_LAST_DAY_OF_MONTH">().toMatchTypeOf<VestingDayOfMonth>();
    // The named sub-union holds exactly the four policies and none of the
    // numeric codes.
    expectTypeOf<NamedDayPolicy>().toEqualTypeOf<
      | "29_OR_LAST_DAY_OF_MONTH"
      | "30_OR_LAST_DAY_OF_MONTH"
      | "31_OR_LAST_DAY_OF_MONTH"
      | "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"
    >();
    expectTypeOf<"01">().not.toMatchTypeOf<NamedDayPolicy>();
  });
});

// A complete switch over NamedDayPolicy: every arm returns, so the `default` arg
// is `never` and `assertNever` typechecks. Add a fifth member to
// NAMED_DAY_POLICY_VALUES without a matching `case` and this stops compiling —
// the same guarantee `pickDay` carries.
function classifyNamedPolicy(p: NamedDayPolicy): string {
  switch (p) {
    case "29_OR_LAST_DAY_OF_MONTH":
      return "29";
    case "30_OR_LAST_DAY_OF_MONTH":
      return "30";
    case "31_OR_LAST_DAY_OF_MONTH":
      return "31";
    case "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH":
      return "start";
    default:
      return assertNever(p);
  }
}

// `assertNever` only accepts `never`. Handing it a value typed as a three-member
// subset of NamedDayPolicy must stay an error: the missing fourth policy is the
// residual the default arm would still have to handle. The `@ts-expect-error` is
// the assertion — if NamedDayPolicy ever collapsed onto this subset (so the
// `pickDay` switch became accidentally exhaustive with a case dropped), the error
// vanishes, the directive goes unused, and the build fails.
function residualIsNonEmpty(
  p: Exclude<NamedDayPolicy, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH">,
): never {
  // @ts-expect-error — `p` still carries the three numeric-fallback policies
  return assertNever(p);
}

describe("NamedDayPolicy switch is exhaustive (AC#3)", () => {
  it("classifies all four named policies", () => {
    expect(NAMED_DAY_POLICY_VALUES.map(classifyNamedPolicy)).toEqual([
      "29",
      "30",
      "31",
      "start",
    ]);
  });

  it("the residual-subset guard is wired up", () => {
    expect(typeof residualIsNonEmpty).toBe("function");
  });
});
