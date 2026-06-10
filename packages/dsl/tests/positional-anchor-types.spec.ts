import { describe, it, expect } from "vitest";
import type { VestingNodeExpr } from "@vestlang/types";

// The type-level companion to systemRefs.spec.ts. That file proves the *parser*
// rejects a misplaced system anchor (vestingStart in a FROM, grantDate in a
// CLIFF) at any selector depth; this proves the *type* rejects it too, so no
// internal code can reconstruct one once past the parser. The assertions here
// are the `@ts-expect-error` lines: if the positional parameter on
// `VestingNodeExpr` ever regresses to a wide base, these directives go unused and
// the build fails. The runtime `expect`s exist only so the fixtures count as used.
describe("positional anchor invariant (type level)", () => {
  it("a start anchor admits GRANT_DATE / DATE / EVENT, never VESTING_START", () => {
    const grant: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE",
      base: { type: "GRANT_DATE" },
      offsets: [],
    };
    const date: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE",
      base: { type: "DATE", value: "2025-01-01" },
      offsets: [],
    };
    const event: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE",
      base: { type: "EVENT", value: "ipo" },
      offsets: [],
    };
    const bad: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE",
      // @ts-expect-error — VESTING_START is not a legal start anchor
      base: { type: "VESTING_START" },
      offsets: [],
    };
    expect([grant, date, event, bad]).toHaveLength(4);
  });

  it("a cliff anchor admits VESTING_START / DATE / EVENT, never GRANT_DATE", () => {
    const vestingStart: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE",
      base: { type: "VESTING_START" },
      offsets: [],
    };
    const bad: VestingNodeExpr<"VESTING_START"> = {
      type: "NODE",
      // @ts-expect-error — GRANT_DATE is not a legal cliff anchor
      base: { type: "GRANT_DATE" },
      offsets: [],
    };
    expect([vestingStart, bad]).toHaveLength(2);
  });

  it("the invariant reaches inside selector arms", () => {
    const okStart: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE_EARLIER_OF",
      items: [
        { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
        { type: "NODE", base: { type: "EVENT", value: "ipo" }, offsets: [] },
      ],
    };
    const badStart: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE_EARLIER_OF",
      items: [
        { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
        // @ts-expect-error — a VESTING_START arm can't hide in a start selector
        { type: "NODE", base: { type: "VESTING_START" }, offsets: [] },
      ],
    };
    expect([okStart, badStart]).toHaveLength(2);
  });
});
