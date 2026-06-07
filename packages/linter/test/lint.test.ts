import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { lintProgram, lintText } from "../src/index.js";

function diagnosticsOf(src: string) {
  const raw = parse(src);
  const program = normalizeProgram(raw);
  return lintProgram(program).diagnostics;
}

describe("@vestlang/linter", () => {
  describe("lintProgram", () => {
    it("returns empty diagnostics for valid normalized programs", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant OVER 12 months EVERY 1 month
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles selectors (EARLIER OF)", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-06-01)
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles selectors (LATER OF)", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM LATER OF (EVENT ipo, EVENT acquisition)
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles top-level schedule selectors", () => {
      const diagnostics = diagnosticsOf(`
        VEST EARLIER OF (
          FROM DATE 2025-01-01,
          FROM DATE 2025-06-01
        )
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles constraints with AND/OR", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant BEFORE DATE 2025-12-31 AND AFTER DATE 2025-01-01
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles complex programs with cliff", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 1 year
      `);
      expect(diagnostics).toEqual([]);
    });
  });

  describe("portion-allocation", () => {
    it("errors when bare statements over-allocate (default 100% each)", () => {
      const diagnostics = diagnosticsOf(`
        VEST OVER 2 years EVERY 1 year PLUS VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });

    it("is clean when portions sum to exactly 100%", () => {
      const diagnostics = diagnosticsOf(`
        1/2 VEST OVER 2 years EVERY 1 year PLUS 1/2 VEST OVER 2 years EVERY 1 year
      `);
      expect(
        diagnostics.filter((d) => d.ruleId === "portion-allocation"),
      ).toEqual([]);
    });

    it("errors when explicit portions over-allocate (sum 5/4)", () => {
      const diagnostics = diagnosticsOf(`
        3/4 VEST OVER 2 years EVERY 1 year PLUS 1/2 VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });

    it("warns when portions under-allocate (sum 1/2)", () => {
      const diagnostics = diagnosticsOf(`
        1/4 VEST OVER 2 years EVERY 1 year PLUS 1/4 VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
    });

    it("leaves a single bare statement alone (default 100% is correct)", () => {
      const diagnostics = diagnosticsOf(`
        VEST OVER 12 months EVERY 1 month
      `);
      expect(
        diagnostics.filter((d) => d.ruleId === "portion-allocation"),
      ).toEqual([]);
    });

    it("does not flag quantity programs (out of scope)", () => {
      const diagnostics = diagnosticsOf(`
        100 VEST OVER 2 years EVERY 1 year PLUS 100 VEST OVER 2 years EVERY 1 year
      `);
      expect(
        diagnostics.filter((d) => d.ruleId === "portion-allocation"),
      ).toEqual([]);
    });

    it("errors on a bare statement mixed with a quantity statement", () => {
      const diagnostics = diagnosticsOf(`
        100 VEST OVER 2 years EVERY 1 year PLUS VEST OVER 2 years EVERY 1 year
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });
  });

  describe("cliff-exceeds-span", () => {
    const flaggedOf = (src: string) =>
      diagnosticsOf(src).filter((d) => d.ruleId === "cliff-exceeds-span");

    it("warns when the cliff outruns its own grid span", () => {
      // span = 4 × 3 = 12 months; an 18-month cliff lands 6 months past the end.
      const flagged = flaggedOf(`
        VEST FROM EVENT grant OVER 12 months EVERY 3 months CLIFF 18 months
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
      expect(flagged[0].path).toEqual([
        "Program",
        0,
        "expr",
        "periodicity",
        "cliff",
      ]);
    });

    it("is clean when the cliff lands exactly on the last tranche", () => {
      // span = 12 months, cliff = 12 months: the whole segment vests at its
      // natural end, not past it.
      expect(
        flaggedOf(`
          VEST FROM EVENT grant OVER 12 months EVERY 1 month CLIFF 12 months
        `),
      ).toEqual([]);
    });

    it("is clean for an ordinary in-grid cliff", () => {
      expect(
        flaggedOf(`
          VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 1 year
        `),
      ).toEqual([]);
    });

    it("skips a cross-unit cliff it can't compare without an anchor", () => {
      // A days cliff over a months grid has no static span comparison.
      expect(
        flaggedOf(`
          VEST FROM EVENT grant OVER 2 months EVERY 1 month CLIFF 100 days
        `),
      ).toEqual([]);
    });

    it("flags a THEN tail whose cliff outruns its own segment", () => {
      const flagged = flaggedOf(`
        VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month
        THEN VEST OVER 4 months EVERY 1 month CLIFF 18 months
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
    });
  });

  // The linter now shares one traversal with the rest of the toolchain. That
  // traversal looks *inside* BEFORE/AFTER gates, which the linter's old walker
  // never did. These cases lock in that the extra reach changes no diagnostics,
  // and that paths/messages are exactly what they were.
  describe("walk migration regression", () => {
    it("walks into a constraint's reference node without flagging anything", () => {
      // Two constraints, each gating on a plain date — nothing here is wrong.
      // The old walker stopped at the ATOM and never saw the constraint bases;
      // the shared walk does, and must stay silent.
      expect(
        diagnosticsOf(`
          VEST FROM EVENT grant BEFORE DATE 2025-12-31 AND AFTER DATE 2025-01-01
        `),
      ).toEqual([]);
    });

    it("walks past an event buried in a constraint base, still silent", () => {
      // The EVENT now gets visited (it's the constraint's reference anchor), but
      // no rule cares about a bare event, so there's still nothing to report.
      expect(
        diagnosticsOf(`
          VEST FROM DATE 2025-01-01 BEFORE EVENT ipo OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
    });

    it("keeps the cliff path stable even when the start carries a constraint", () => {
      // span = 4 × 3 = 12 months; an 18-month cliff overruns by 6. The start
      // node also carries a BEFORE gate, so the walk descends a constraint
      // subtree on the way — the reported cliff path must be unaffected.
      const diagnostics = diagnosticsOf(`
        VEST FROM DATE 2025-01-01 BEFORE EVENT ipo OVER 12 months EVERY 3 months CLIFF 18 months
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "cliff-exceeds-span",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
      expect(flagged[0].path).toEqual([
        "Program",
        0,
        "expr",
        "periodicity",
        "cliff",
      ]);
    });
  });

  // A duplicate selector arm can't reach `lintProgram` — the normalizer dedupes
  // it during canonicalization, before the linter runs. So the warning is raised
  // by the normalizer itself and surfaced through `lintText`, which threads a
  // sink into `normalizeProgram` and merges what comes back.
  describe("duplicate selector arm (via lintText)", () => {
    const lint = (src: string) => lintText(src, parse).diagnostics;

    it("warns on a repeated selector arm, with the plain keyword", () => {
      const flagged = lint(
        `VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-01-01)`,
      ).filter((d) => d.ruleId === "no-duplicate-selector-items");
      expect(flagged).toEqual([
        {
          ruleId: "no-duplicate-selector-items",
          message: "EARLIER OF contains duplicate items",
          severity: "warning",
          path: ["Program", 0],
        },
      ]);
    });

    it("stays silent on distinct selector arms", () => {
      expect(
        lint(`VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-06-01)`).filter(
          (d) => d.ruleId === "no-duplicate-selector-items",
        ),
      ).toEqual([]);
    });

    it("does not surface the warning through lintProgram on a normalized program", () => {
      // The duplicate is already gone by the time lintProgram sees the program.
      const program = normalizeProgram(
        parse(`VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-01-01)`),
      );
      expect(lintProgram(program).diagnostics).toEqual([]);
    });
  });

  // A bare mixed `… OR … AND …` groups by SQL precedence (AND binds tighter) with
  // nothing in the source to show it. The parser flags it; the normalizer surfaces
  // the warning through the same `lintText` sink, since the grouping is invisible
  // on the normalized tree. Explicit grouping — parens or AND(…)/OR(…) — is silent.
  describe("implicit mixed boolean (via lintText)", () => {
    const OVER = `OVER 4 years EVERY 1 month`;
    const lint = (condition: string) =>
      lintText(
        `VEST FROM EVENT m ${condition} ${OVER}`,
        parse,
      ).diagnostics.filter((d) => d.ruleId === "no-implicit-mixed-boolean");

    it("warns on a bare mixed AND/OR and teaches the grouping", () => {
      const flagged = lint(
        `BEFORE EVENT ipo OR BEFORE DATE 2026-01-01 AND AFTER DATE 2025-01-01`,
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].ruleId).toBe("no-implicit-mixed-boolean");
      expect(flagged[0].severity).toBe("warning");
      expect(flagged[0].path).toEqual(["Program", 0]);
      // carries the OR's source span
      expect(flagged[0].loc?.start.line).toBe(1);
      expect(typeof flagged[0].loc?.start.column).toBe("number");
      // teaches the precedence rather than naming a notation to switch to
      expect(flagged[0].message).toMatch(/AND binds tighter than OR/);
      expect(flagged[0].message).not.toMatch(/AND\(/);
    });

    it("warns regardless of which operator comes first", () => {
      // `a AND b OR c` groups as `(a AND b) OR c` — still a silent mix.
      expect(
        lint(
          `BEFORE EVENT ipo AND AFTER DATE 2025-01-01 OR AFTER DATE 2024-01-01`,
        ),
      ).toHaveLength(1);
    });

    it("stays silent on a single operator", () => {
      expect(lint(`BEFORE EVENT ipo AND AFTER DATE 2025-01-01`)).toEqual([]);
      expect(lint(`BEFORE EVENT ipo OR AFTER DATE 2025-01-01`)).toEqual([]);
    });

    it("stays silent on the explicit functional form", () => {
      expect(
        lint(
          `OR(BEFORE EVENT ipo, AND(BEFORE DATE 2026-01-01, AFTER DATE 2025-01-01))`,
        ),
      ).toEqual([]);
    });

    it("stays silent when either side is parenthesized", () => {
      expect(
        lint(
          `BEFORE EVENT ipo OR (BEFORE DATE 2026-01-01 AND AFTER DATE 2025-01-01)`,
        ),
      ).toEqual([]);
      expect(
        lint(
          `(BEFORE EVENT ipo OR BEFORE DATE 2026-01-01) AND AFTER DATE 2025-01-01`,
        ),
      ).toEqual([]);
    });

    it("stays silent on a zero/one-constraint anchor", () => {
      expect(lint(`BEFORE EVENT ipo`)).toEqual([]);
    });

    it("flags only the inner mix when an outer group is explicit", () => {
      // The inner `… OR … AND …` is the bare mix; the outer AND is parenthesized
      // around it, so exactly one warning is raised.
      const flagged = lint(
        `AFTER DATE 2024-01-01 AND (BEFORE EVENT ipo OR BEFORE DATE 2026-01-01 AND AFTER DATE 2025-01-01)`,
      );
      expect(flagged).toHaveLength(1);
    });

    it("does not surface the warning through lintProgram on a normalized program", () => {
      // The parser's marker is stripped during normalization, so lintProgram —
      // which sees only the normalized tree — has nothing to report.
      const program = normalizeProgram(
        parse(
          `VEST FROM EVENT m BEFORE EVENT ipo OR BEFORE DATE 2026-01-01 AND AFTER DATE 2025-01-01 ${OVER}`,
        ),
      );
      expect(
        lintProgram(program).diagnostics.filter(
          (d) => d.ruleId === "no-implicit-mixed-boolean",
        ),
      ).toEqual([]);
    });
  });
});
