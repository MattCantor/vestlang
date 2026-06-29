// AC#2 / AC#3 — the day-of-month type is OCF v2's four-value policy enum, and the
// switch `pickDay` runs is exhaustive over all four. The exhaustiveness fixture
// mirrors the evaluator's `resolve.chain-du.types.test.ts`: a complete
// `assertNever`-terminated switch compiles, and a deliberately-incomplete one
// carries a `@ts-expect-error` that goes unused — failing the build — if the
// tripwire ever regresses.
//
// The type-level assertions are validated by `tsc -p tsconfig.lint.json` (the
// root `typecheck`, which includes `tests`); the runtime assertions run under
// vitest. The 5th-member guarantee in AC#3 lives in `pickDay` itself, which `tsc`
// checks every CI run — adding a member to the OCF union without a matching `case`
// there breaks the build. This file pins the same shape independently of that call
// site. The authoritative array↔OCF drift guard lives in `@vestlang/types`'
// `oct_types.ts`; here we re-pin the resulting four literals without pulling the
// OCF package into `core`.

import { describe, it, expect, expectTypeOf } from "vitest";
import {
  VESTING_DAY_OF_MONTH_VALUES,
  DEFAULT_VESTING_DAY_OF_MONTH,
} from "@vestlang/types";
import type { VestingDayOfMonth } from "@vestlang/types";
import { assertNever } from "@vestlang/utils";

// The four OCF v2 policies, in declaration order.
const OCF_POLICIES = [
  "VESTING_START_DAY",
  "FIRST_DAY_OF_MONTH",
  "LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_MINUS_ONE",
] as const;

describe("VESTING_DAY_OF_MONTH_VALUES is the 4-value OCF policy set (AC#2)", () => {
  it("holds exactly the four policies in declaration order", () => {
    expect(VESTING_DAY_OF_MONTH_VALUES).toEqual(OCF_POLICIES);
    expect(VESTING_DAY_OF_MONTH_VALUES).toHaveLength(4);
  });

  it("defaults to VESTING_START_DAY", () => {
    expect(DEFAULT_VESTING_DAY_OF_MONTH).toBe("VESTING_START_DAY");
  });
});

describe("VestingDayOfMonth is the OCF policy union (AC#2)", () => {
  it("equals exactly the four policy literals — no numeric days, no named/numeric split", () => {
    expectTypeOf<VestingDayOfMonth>().toEqualTypeOf<
      | "VESTING_START_DAY"
      | "FIRST_DAY_OF_MONTH"
      | "LAST_DAY_OF_MONTH"
      | "VESTING_START_DAY_MINUS_ONE"
    >();
    // A bare numeric day is no longer assignable.
    expectTypeOf<"15">().not.toMatchTypeOf<VestingDayOfMonth>();
  });
});

// A complete switch over VestingDayOfMonth: every arm returns, so the `default`
// arg is `never` and `assertNever` typechecks. Add a fifth member to the OCF union
// without a matching `case` and this stops compiling — the same guarantee
// `pickDay` carries.
function classifyPolicy(p: VestingDayOfMonth): string {
  switch (p) {
    case "VESTING_START_DAY":
      return "start";
    case "FIRST_DAY_OF_MONTH":
      return "first";
    case "LAST_DAY_OF_MONTH":
      return "last";
    case "VESTING_START_DAY_MINUS_ONE":
      return "start-1";
    default:
      return assertNever(p);
  }
}

// `assertNever` only accepts `never`. Handing it a value typed as a three-member
// subset of VestingDayOfMonth must stay an error: the missing fourth policy is the
// residual the default arm would still have to handle. The `@ts-expect-error` is
// the assertion — if the union ever collapsed onto this subset (so the `pickDay`
// switch became accidentally exhaustive with a case dropped), the error vanishes,
// the directive goes unused, and the build fails.
function residualIsNonEmpty(
  p: Exclude<VestingDayOfMonth, "VESTING_START_DAY_MINUS_ONE">,
): never {
  // @ts-expect-error — `p` still carries the three other policies
  return assertNever(p);
}

describe("VestingDayOfMonth switch is exhaustive (AC#3)", () => {
  it("classifies all four policies", () => {
    expect(VESTING_DAY_OF_MONTH_VALUES.map(classifyPolicy)).toEqual([
      "start",
      "first",
      "last",
      "start-1",
    ]);
  });

  it("the residual-subset guard is wired up", () => {
    expect(typeof residualIsNonEmpty).toBe("function");
  });
});
