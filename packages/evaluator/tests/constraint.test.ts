// tests/constraint.test.ts
import { describe, it, expect } from "vitest";
import { evaluateConstraint } from "../src/evaluate/vestingNode/constraint.js";
import {
  makeResolvedNode,
  makeUnresolvedNode,
  makeConstrainedNodeWithAtomCondition,
  makeImpossibleConditionBlocker,
  makeVestingBaseDate,
} from "./helpers.js";
import { ImpossibleNode, OCTDate, UnresolvedBlocker } from "@vestlang/types";

const aDate = "2024-01-31" as OCTDate;
const bDate = "2024-02-01" as OCTDate;

describe("evaluateConstraint", () => {
  it("BEFORE satisfied when A resolved earlier than B", () => {
    const constraindedNode = makeConstrainedNodeWithAtomCondition(
      "BEFORE",
      aDate,
      bDate,
    );
    const a = makeResolvedNode(aDate);
    const b = makeResolvedNode(bDate);
    expect(evaluateConstraint(a, b, constraindedNode)).toBeUndefined();
  });

  it("BEFORE fails strictly when A == B and strict", () => {
    const constrainedNode = makeConstrainedNodeWithAtomCondition(
      "BEFORE",
      aDate,
      aDate,
      true,
    );
    const a = makeResolvedNode(aDate);
    const b = makeResolvedNode(aDate);
    const out = evaluateConstraint(a, b, constrainedNode);
    expect(out![0].type).toBe("IMPOSSIBLE_CONDITION");
  });

  it("AFTER unresolved when A unresolved and B resolved (A might still be after)", () => {
    const constrainedNode = makeConstrainedNodeWithAtomCondition(
      "AFTER",
      aDate,
      bDate,
    );
    const a = makeUnresolvedNode({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "milestone",
    });
    const b = makeResolvedNode(bDate);
    const out = evaluateConstraint(a, b, constrainedNode)!;
    expect(out[0].type).toBe("EVENT_NOT_YET_OCCURRED");
  });

  it("AFTER impossible when B impossible", () => {
    const constrainedNode = makeConstrainedNodeWithAtomCondition(
      "AFTER",
      aDate,
      bDate,
    );
    const a = makeResolvedNode(aDate);
    const b: ImpossibleNode = {
      type: "IMPOSSIBLE",
      blockers: [makeImpossibleConditionBlocker(makeVestingBaseDate(aDate))],
    };
    const out = evaluateConstraint(a, b, constrainedNode)!;
    expect(out[0].type).toBe("IMPOSSIBLE_CONDITION");
  });

  it("BEFORE indeterminate when A and B unresolved merges blockers", () => {
    const constrainedNode = makeConstrainedNodeWithAtomCondition(
      "BEFORE",
      aDate,
      bDate,
    );
    const a = makeUnresolvedNode({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "a",
    });
    const b = makeUnresolvedNode({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "b",
    } as UnresolvedBlocker);
    const out = evaluateConstraint(a, b, constrainedNode)!;
    expect(out.some((b) => b.type === "UNRESOLVED_CONDITION")).toBe(true);
  });
});
