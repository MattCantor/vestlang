// tests/constraint.test.ts
import { describe, it, expect } from "vitest";
import { evaluateConstraint } from "../src/interpret/vestingNode/constraint.js";
import {
  makeResolvedNode,
  makeUnresolvedNode,
  makeConstrainedNodeWithAtomCondition,
  makeImpossibleConditionBlocker,
  makeVestingBaseDate,
} from "./helpers.js";
import { ImpossibleNode, OCTDate } from "@vestlang/types";

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
    });
    const out = evaluateConstraint(a, b, constrainedNode)!;
    expect(out.some((b) => b.type === "UNRESOLVED_CONDITION")).toBe(true);
  });

  // An unfired event on either side keeps the comparison pending — it never
  // settles to satisfied (undefined) or impossible. These three cells used to
  // commit a verdict off the event's absence; they must now wait.
  const pendingEvent = () =>
    makeUnresolvedNode({ type: "EVENT_NOT_YET_OCCURRED", event: "e" });
  const isPending = (out: ReturnType<typeof evaluateConstraint>) => {
    expect(out).toBeDefined();
    expect(out!.some((x) => x.type === "UNRESOLVED_CONDITION")).toBe(true);
    expect(out!.some((x) => x.type === "IMPOSSIBLE_CONDITION")).toBe(false);
  };

  it("BEFORE pending when A resolved and B is an unfired event", () => {
    const cn = makeConstrainedNodeWithAtomCondition("BEFORE", aDate, bDate);
    isPending(evaluateConstraint(makeResolvedNode(aDate), pendingEvent(), cn));
  });

  it("AFTER pending when A resolved and B is an unfired event", () => {
    const cn = makeConstrainedNodeWithAtomCondition("AFTER", aDate, bDate);
    isPending(evaluateConstraint(makeResolvedNode(aDate), pendingEvent(), cn));
  });

  it("BEFORE pending when A is an unfired event and B resolved", () => {
    const cn = makeConstrainedNodeWithAtomCondition("BEFORE", aDate, bDate);
    isPending(evaluateConstraint(pendingEvent(), makeResolvedNode(bDate), cn));
  });
});
