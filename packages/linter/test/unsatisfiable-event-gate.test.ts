import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { lintProgram } from "../src/index.js";

// The event analog of `unsatisfiable-date-window`: a gate that pins both sides to
// the same non-date anchor and can never be satisfied whenever the event fires.
// The date rule stays untouched; these pin the new rule's diagnostics and paths.

const flaggedOf = (src: string) => {
  const program = normalizeProgram(parse(src));
  return lintProgram(program).diagnostics.filter(
    (d) => d.ruleId === "unsatisfiable-event-gate",
  );
};

describe("unsatisfiable-event-gate", () => {
  describe("reflexive self-reference (reports at the node)", () => {
    it("errors on an event strictly after itself, pointing at the start node", () => {
      const flagged = flaggedOf(
        "VEST FROM EVENT ipo STRICTLY AFTER EVENT ipo OVER 12 months EVERY 1 month",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
      expect(flagged[0].path).toEqual(["Program", 0, "expr", "vesting_start"]);
    });

    it("errors on an event strictly before itself", () => {
      const flagged = flaggedOf(
        "VEST FROM EVENT ipo STRICTLY BEFORE EVENT ipo OVER 12 months EVERY 1 month",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
      expect(flagged[0].path).toEqual(["Program", 0, "expr", "vesting_start"]);
    });

    it("errors on a determinately-positive offset ahead of the same event", () => {
      // a AFTER a + 1 month — the anchor can never reach a strictly later point.
      const flagged = flaggedOf(
        "VEST FROM EVENT a AFTER EVENT a + 1 month OVER 12 months EVERY 1 month",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });

    it("errors on a system anchor strictly after itself (lint-only class)", () => {
      // grantDate STRICTLY AFTER grantDate: already `impossible` to store on main,
      // but it linted clean — this closes that lint gap.
      const flagged = flaggedOf(
        "VEST FROM grantDate STRICTLY AFTER grantDate OVER 12 months EVERY 1 month",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
      expect(flagged[0].path).toEqual(["Program", 0, "expr", "vesting_start"]);
    });

    it("errors on a self-referential cliff gate, pointing at the cliff node", () => {
      const flagged = flaggedOf(
        "VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF EVENT v STRICTLY AFTER EVENT v",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
      expect(flagged[0].path).toEqual(["Program", 0, "expr", "cliff"]);
    });
  });

  describe("same-operand empty window (reports at the condition)", () => {
    it("errors on an AFTER/STRICTLY-BEFORE pair against one event, pointing at the condition", () => {
      const flagged = flaggedOf(
        "VEST FROM EVENT s AFTER EVENT b AND STRICTLY BEFORE EVENT b OVER 12 months EVERY 1 month",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
      expect(flagged[0].path).toEqual([
        "Program",
        0,
        "expr",
        "vesting_start",
        "condition",
      ]);
    });
  });

  describe("stays silent on satisfiable same-anchor gates (no false positive)", () => {
    it("is clean on a non-strict self-comparison (zero delta holds)", () => {
      expect(
        flaggedOf(
          "VEST FROM EVENT ipo AFTER EVENT ipo OVER 12 months EVERY 1 month",
        ),
      ).toEqual([]);
    });

    it("is clean on a determinately-negative delta", () => {
      expect(
        flaggedOf(
          "VEST FROM EVENT a STRICTLY AFTER EVENT a - 1 day OVER 12 months EVERY 1 month",
        ),
      ).toEqual([]);
    });

    it("is clean on the BEFORE side of a positive delta", () => {
      expect(
        flaggedOf(
          "VEST FROM EVENT a STRICTLY BEFORE EVENT a + 1 month OVER 12 months EVERY 1 month",
        ),
      ).toEqual([]);
    });

    it("abstains on an indeterminate mixed-sign offset delta", () => {
      expect(
        flaggedOf(
          "VEST FROM EVENT a AFTER EVENT a + 1 month - 29 days OVER 12 months EVERY 1 month",
        ),
      ).toEqual([]);
    });

    it("does not touch a fixed-date self-reference (the date rule owns that)", () => {
      expect(
        flaggedOf(
          "VEST FROM DATE 2025-01-01 STRICTLY AFTER DATE 2025-01-01 OVER 12 months EVERY 1 month",
        ),
      ).toEqual([]);
    });
  });
});
