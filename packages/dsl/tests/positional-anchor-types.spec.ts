import { describe, it, expect } from "vitest";
import type { Condition, VestingNodeExpr } from "@vestlang/types";

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

// The #355 gate-base rule. A node's *gate* (its BEFORE/AFTER reference) is held to
// `GRANT_DATE | A`: a start's gate (A = "GRANT_DATE") may reference GRANT_DATE /
// DATE / EVENT but NOT VESTING_START — that is circular, the gate constraining the
// very start it defines. A cliff's gate (A = "VESTING_START") widens to admit
// VESTING_START too (#351), while still admitting GRANT_DATE (#113). The
// `@ts-expect-error` lines are the assertions: if the threading regresses, they go
// unused and the build fails. The `expect`s only keep the fixtures "used".
describe("gate-base positional rule (type level, #355)", () => {
  // The gate's reference is a whole VestingNode (a comparison point), so each base
  // anchor below is wrapped in a NODE. A start node carries Condition<"GRANT_DATE">,
  // a cliff Condition<"VESTING_START">; annotating the literal's slot is what flips
  // which gate bases the type admits.
  it("a start's gate admits GRANT_DATE / DATE / EVENT, never VESTING_START", () => {
    const onGrantDate: Condition<"GRANT_DATE"> = {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        // grant-date gate on a start stays legal (#113)
        base: { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
        strict: false,
      },
    };
    const onDate: Condition<"GRANT_DATE"> = {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        base: {
          type: "NODE",
          base: { type: "DATE", value: "2025-01-01" },
          offsets: [],
        },
        strict: false,
      },
    };
    const onEvent: Condition<"GRANT_DATE"> = {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        base: {
          type: "NODE",
          base: { type: "EVENT", value: "ipo" },
          offsets: [],
        },
        strict: false,
      },
    };
    const circular: Condition<"GRANT_DATE"> = {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        base: {
          type: "NODE",
          // @ts-expect-error — a start's gate cannot reference vestingStart (circular)
          base: { type: "VESTING_START" },
          offsets: [],
        },
        strict: false,
      },
    };
    expect([onGrantDate, onDate, onEvent, circular]).toHaveLength(4);
  });

  it("a cliff's gate admits VESTING_START (#351) and GRANT_DATE (#113)", () => {
    const onVestingStart: Condition<"VESTING_START"> = {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        // legal on a cliff (#351)
        base: { type: "NODE", base: { type: "VESTING_START" }, offsets: [] },
        strict: false,
      },
    };
    const onGrantDate: Condition<"VESTING_START"> = {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        // still legal on a cliff (#113)
        base: { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
        strict: false,
      },
    };
    expect([onVestingStart, onGrantDate]).toHaveLength(2);
  });

  it("the start forbiddance reaches a NESTED gate (a gate on the gate base)", () => {
    // `start AFTER (x AFTER vestingStart)`: the gate's reference node `x` carries
    // its own gate, and because the base node is typed VestingNode<"GRANT_DATE">
    // too, that inner gate inherits the same forbiddance.
    const nestedCircular: Condition<"GRANT_DATE"> = {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        base: {
          type: "NODE",
          base: { type: "DATE", value: "2025-01-01" },
          offsets: [],
          condition: {
            type: "ATOM",
            constraint: {
              type: "AFTER",
              base: {
                type: "NODE",
                // @ts-expect-error — vestingStart can't hide in a start's nested gate
                base: { type: "VESTING_START" },
                offsets: [],
              },
              strict: false,
            },
          },
        },
        strict: false,
      },
    };
    expect(nestedCircular.type).toBe("ATOM");
  });

  it("the start forbiddance reaches inside an AND arm of the gate", () => {
    // The gate is a boolean group; the forbidden base hides in one arm.
    const inAndArm: Condition<"GRANT_DATE"> = {
      type: "AND",
      items: [
        {
          type: "ATOM",
          constraint: {
            type: "AFTER",
            base: { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
            strict: false,
          },
        },
        {
          type: "ATOM",
          constraint: {
            type: "AFTER",
            base: {
              type: "NODE",
              // @ts-expect-error — vestingStart can't hide in one AND arm of a start gate
              base: { type: "VESTING_START" },
              offsets: [],
            },
            strict: false,
          },
        },
      ],
    };
    expect(inAndArm.type).toBe("AND");
  });

  it("the start forbiddance reaches a gate inside a SELECTOR arm", () => {
    // The start is itself an EARLIER OF; one arm carries a gate whose reference
    // base is vestingStart. Because `A` threads through the selector arms, that
    // arm's gate inherits the start's forbiddance — the circular base can't hide
    // behind the selector.
    const inSelectorArmGate: VestingNodeExpr<"GRANT_DATE"> = {
      type: "NODE_EARLIER_OF",
      items: [
        { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
        {
          type: "NODE",
          base: { type: "DATE", value: "2025-01-01" },
          offsets: [],
          condition: {
            type: "ATOM",
            constraint: {
              type: "AFTER",
              base: {
                type: "NODE",
                // @ts-expect-error — vestingStart can't hide in a selector arm's gate on a start
                base: { type: "VESTING_START" },
                offsets: [],
              },
              strict: false,
            },
          },
        },
      ],
    };
    expect(inSelectorArmGate.type).toBe("NODE_EARLIER_OF");
  });
});
