import { describe, it, expect } from "vitest";
import type { ResolutionContextInput } from "@vestlang/types";
import { evaluateProgram } from "@vestlang/evaluator";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { lintText } from "@vestlang/linter";
import { runPersist } from "../src/persist.js";
import { presentSchedule } from "../src/present.js";

// The transitive reach of the new same-anchor analysis through the consumer front
// door: persist refuses these programs, and the presentation reads them as not
// representable — exactly the surfaces an author or the MCP loop sees.

const persist = (dsl: string) =>
  runPersist({ dsl, grant_date: "2025-01-01", grant_quantity: 1200 });

const present = (dsl: string, events: Record<string, string> = {}) =>
  presentSchedule(
    evaluateProgram(normalizeProgram(parse(dsl)), {
      grantDate: "2025-01-01",
      grantQuantity: 1200,
      events,
    } satisfies ResolutionContextInput),
  );

const IMPOSSIBLE = [
  "VEST FROM EVENT ipo STRICTLY AFTER EVENT ipo OVER 12 months EVERY 1 month",
  "VEST FROM EVENT ipo STRICTLY BEFORE EVENT ipo OVER 12 months EVERY 1 month",
  "VEST FROM EVENT s AFTER EVENT b AND STRICTLY BEFORE EVENT b OVER 12 months EVERY 1 month",
  "VEST FROM EVENT a AFTER EVENT a + 1 month OVER 12 months EVERY 1 month",
  "VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF EVENT v STRICTLY AFTER EVENT v",
];

const SATISFIABLE = [
  "VEST FROM EVENT ipo AFTER EVENT ipo OVER 12 months EVERY 1 month",
  "VEST FROM EVENT a STRICTLY AFTER EVENT a - 1 day OVER 12 months EVERY 1 month",
  "VEST FROM EVENT a STRICTLY BEFORE EVENT a + 1 month OVER 12 months EVERY 1 month",
  "VEST FROM EVENT a AFTER EVENT a + 1 month - 29 days OVER 12 months EVERY 1 month",
];

describe("self-referential event gate — persist refuses, naming the diagnostic", () => {
  for (const dsl of IMPOSSIBLE) {
    it(`refuses: ${dsl}`, () => {
      const r = persist(dsl);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.ruleId).toBe("persist-not-storable");
      expect(r.error.message).toMatch(/unsatisfiable-event-gate/);
    });
  }
});

describe("self-referential event gate — satisfiable gates still persist", () => {
  for (const dsl of SATISFIABLE) {
    it(`persists: ${dsl}`, () => {
      expect(persist(dsl).ok).toBe(true);
    });
  }
});

describe("self-referential event gate — presentation reads not-representable", () => {
  it("a self-referential gate is not representable once its event fires", () => {
    expect(
      present(
        "VEST FROM EVENT ipo STRICTLY AFTER EVENT ipo OVER 12 months EVERY 1 month",
        { ipo: "2026-03-01" },
      ).representable,
    ).toBe(false);
  });

  it("a satisfiable same-anchor gate stays representable", () => {
    expect(
      present(
        "VEST FROM EVENT ipo AFTER EVENT ipo OVER 12 months EVERY 1 month",
        {
          ipo: "2026-03-01",
        },
      ).representable,
    ).toBe(true);
  });
});

describe("self-referential event gate — the diagnostic surfaces through lintText", () => {
  it("names the rule at error severity", () => {
    const flagged = lintText(
      "VEST FROM EVENT ipo STRICTLY AFTER EVENT ipo OVER 12 months EVERY 1 month",
    ).diagnostics.filter((d) => d.ruleId === "unsatisfiable-event-gate");
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe("error");
  });
});
