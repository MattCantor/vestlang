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
        VEST EARLIER START OF (
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

    it("warns on a lone explicit portion that under-allocates (1/2)", () => {
      const diagnostics = diagnosticsOf(`
        1/2 VEST OVER 12 months EVERY 1 month
      `);
      const flagged = diagnostics.filter(
        (d) => d.ruleId === "portion-allocation",
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("warning");
    });

    // A single portion above 100% never reaches the linter — the parser rejects
    // it, the same way it rejects a 1.5 decimal. Over-allocation that the rule
    // still owns is the *sum* case (see the 5/4 test above), where each portion
    // is in range but they add up past the whole.
    it("rejects a lone explicit portion over 100% (3/2) at parse time", () => {
      expect(() =>
        diagnosticsOf(`
          3/2 VEST OVER 12 months EVERY 1 month
        `),
      ).toThrowError(/between 0 and 1 inclusive/);
    });

    it("leaves a lone quantity statement alone (no grant total to sum)", () => {
      const diagnostics = diagnosticsOf(`
        100 VEST OVER 12 months EVERY 1 month
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

  describe("unsatisfiable-date-window", () => {
    const flaggedOf = (src: string) =>
      diagnosticsOf(src).filter(
        (d) => d.ruleId === "unsatisfiable-date-window",
      );

    it("errors on an empty AFTER/BEFORE window (issue #141 repro)", () => {
      const flagged = flaggedOf(`
        VEST FROM EVENT x AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 48 months EVERY 1 month
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0]).toEqual({
        ruleId: "unsatisfiable-date-window",
        message:
          "this gate's date window is empty: no date is on or after 2026-01-01 and on or before 2025-01-01",
        severity: "error",
        path: ["Program", 0, "expr", "vesting_start", "condition"],
      });
    });

    it("is clean on a satisfiable window", () => {
      expect(
        flaggedOf(`
          VEST FROM EVENT board AFTER DATE 2025-01-01 AND BEFORE DATE 2025-12-31 OVER 48 months EVERY 1 month
        `),
      ).toEqual([]);
    });

    it("treats equal non-strict bounds as a one-day window (clean)", () => {
      expect(
        flaggedOf(`
          VEST FROM EVENT x AFTER DATE 2025-01-01 AND BEFORE DATE 2025-01-01 OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
    });

    it("errors when equal bounds have a strict side", () => {
      const flagged = flaggedOf(`
        VEST FROM EVENT x STRICTLY AFTER DATE 2025-01-01 AND BEFORE DATE 2025-01-01 OVER 4 months EVERY 1 month
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].severity).toBe("error");
    });

    it("errors on adjacent days with both sides strict", () => {
      expect(
        flaggedOf(`
          VEST FROM EVENT x STRICTLY AFTER DATE 2025-01-01 AND STRICTLY BEFORE DATE 2025-01-02 OVER 4 months EVERY 1 month
        `),
      ).toHaveLength(1);
      // Drop one STRICTLY and the one-day window opens up.
      expect(
        flaggedOf(`
          VEST FROM EVENT x STRICTLY AFTER DATE 2025-01-01 AND BEFORE DATE 2025-01-02 OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
    });

    it("stays silent when any OR alternative is live", () => {
      expect(
        flaggedOf(`
          VEST FROM EVENT x OR(AND(AFTER DATE 2026-01-01, BEFORE DATE 2025-01-01), AFTER DATE 2027-01-01) OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
    });

    it("errors when every OR alternative is empty", () => {
      const flagged = flaggedOf(`
        VEST FROM EVENT x OR(AND(AFTER DATE 2026-01-01, BEFORE DATE 2025-01-01), AND(AFTER DATE 2028-01-01, BEFORE DATE 2027-01-01)) OVER 4 months EVERY 1 month
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].message).toMatch(/every OR alternative/);
    });

    it("skips atoms it cannot statically date", () => {
      // A symbolic (event) anchor on one side leaves the window open.
      expect(
        flaggedOf(`
          VEST FROM EVENT x AFTER EVENT y AND BEFORE DATE 2025-01-01 OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
      // A DATE carrying an offset isn't statically datable either.
      expect(
        flaggedOf(`
          VEST FROM EVENT x AFTER DATE 2026-01-01 + 1 month AND BEFORE DATE 2025-01-01 OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
    });

    it("errors when a fixed anchor date falls outside its window", () => {
      const flagged = flaggedOf(`
        VEST FROM DATE 2024-06-01 AFTER DATE 2026-01-01 OVER 4 months EVERY 1 month
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].path).toEqual(["Program", 0, "expr", "vesting_start"]);
      expect(flagged[0].message).toBe(
        "anchor date 2024-06-01 falls outside this gate's date window; the gate can never be satisfied",
      );
      // An anchor inside its own window is fine.
      expect(
        flaggedOf(`
          VEST FROM DATE 2026-06-01 AFTER DATE 2026-01-01 OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
    });

    it("checks gated cliffs too", () => {
      const flagged = flaggedOf(`
        VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month CLIFF EVENT fda AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].path).toEqual([
        "Program",
        0,
        "expr",
        "cliff",
        "condition",
      ]);
    });

    it("surfaces through lintText", () => {
      const flagged = lintText(
        `VEST FROM EVENT x AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 48 months EVERY 1 month`,
      ).diagnostics.filter((d) => d.ruleId === "unsatisfiable-date-window");
      expect(flagged).toHaveLength(1);
      expect(flagged[0].message).toBe(
        "this gate's date window is empty: no date is on or after 2026-01-01 and on or before 2025-01-01",
      );
    });

    // Build an AND of `count` disjoint-arm OR groups: each group is
    // `(BEFORE d_low OR AFTER d_high)` with d_low < d_high and distinct dates,
    // so it carves a hole [d_low, d_high] out of the line. Disjoint arms are
    // what matters: the issue's `AFTER d1 OR AFTER d2` merges to one interval and
    // never exercises the blowup, whereas these stay two-interval and a
    // cross-product would double per conjunct (2^count windows). A merge-sweep
    // keeps it linear.
    const disjointArmAnd = (count: number): string => {
      const groups = Array.from({ length: count }, (_, i) => {
        const year = 2010 + i;
        return `OR(BEFORE DATE ${year}-01-01, AFTER DATE ${year}-06-01)`;
      });
      return `VEST FROM EVENT x AND(${groups.join(", ")}) OVER 4 months EVERY 1 month`;
    };

    // (a) no-blowup: 30 disjoint-arm conjuncts lint to a verdict well inside a
    // deterministic per-test timeout. A 2^30 cross-product implementation hangs
    // past 2 s; the merge-sweep finishes in milliseconds.
    it(
      "lints a 30-conjunct disjoint-arm AND-of-OR without exponential blowup",
      { timeout: 2000 },
      () => {
        // (b) the same input is satisfiable — every date outside all 30 holes
        // survives — so no diagnostic.
        expect(flaggedOf(disjointArmAnd(30))).toEqual([]);
      },
    );

    // (c) genuinely unsatisfiable deep AND-of-OR: among the disjoint-arm groups,
    // one forces AFTER 2030-01-01 and another forces BEFORE 2020-01-01, so the
    // merged interval-set intersects to empty. Exactly one diagnostic — the cap
    // approach this rewrite replaced would have missed it.
    it("flags a genuinely unsatisfiable deep AND-of-OR exactly once", () => {
      const groups = Array.from({ length: 10 }, (_, i) => {
        const year = 2040 + i;
        return `OR(BEFORE DATE ${year}-01-01, AFTER DATE ${year}-06-01)`;
      });
      groups.push("OR(AFTER DATE 2030-01-01, AFTER DATE 2031-01-01)");
      groups.push("OR(BEFORE DATE 2020-01-01, BEFORE DATE 2019-01-01)");
      const flagged = flaggedOf(
        `VEST FROM EVENT x AND(${groups.join(", ")}) OVER 4 months EVERY 1 month`,
      );
      expect(flagged).toHaveLength(1);
      expect(flagged[0].ruleId).toBe("unsatisfiable-date-window");
    });

    // (d) a large condition with one undatable atom contributes the full line
    // and can never make the set empty — it stays clean at scale.
    it("stays clean on a large AND containing one undatable anchor", () => {
      const groups = Array.from({ length: 29 }, (_, i) => {
        const year = 2040 + i;
        return `OR(BEFORE DATE ${year}-01-01, AFTER DATE ${year}-06-01)`;
      });
      groups.push("AFTER EVENT y");
      expect(
        flaggedOf(
          `VEST FROM EVENT x AND(${groups.join(", ")}) OVER 4 months EVERY 1 month`,
        ),
      ).toEqual([]);
    });

    // (parity) a mixed empty-datable + undatable-conjunct AND with no OR still
    // selects the *detailed* message — pins the no-OR message-selection branch.
    it("keeps the detailed message for an OR-free empty window beside an undatable conjunct", () => {
      const flagged = flaggedOf(`
        VEST FROM EVENT x AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 AND AFTER EVENT y OVER 4 months EVERY 1 month
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].message).toBe(
        "this gate's date window is empty: no date is on or after 2026-01-01 and on or before 2025-01-01",
      );
    });

    // The OR-union merge is strictness-aware at a shared endpoint, and that
    // distinction flips the verdict. Both arms meet at d; pinning the rest of the
    // AND to exactly d isolates whether the union covers d.
    it("leaves a hole at a shared day when both OR arms are strict", () => {
      // (.., d) ∪ (d, ..) excludes d, so the AND forcing exactly d is empty.
      const flagged = flaggedOf(`
        VEST FROM EVENT x AND(OR(STRICTLY BEFORE DATE 2025-06-01, STRICTLY AFTER DATE 2025-06-01), AFTER DATE 2025-06-01, BEFORE DATE 2025-06-01) OVER 4 months EVERY 1 month
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].ruleId).toBe("unsatisfiable-date-window");
    });

    it("covers a shared day when an OR arm includes it", () => {
      // (.., d] ∪ [d, ..) covers d, so the same exactly-d AND stays satisfiable.
      expect(
        flaggedOf(`
          VEST FROM EVENT x AND(OR(BEFORE DATE 2025-06-01, AFTER DATE 2025-06-01), AFTER DATE 2025-06-01, BEFORE DATE 2025-06-01) OVER 4 months EVERY 1 month
        `),
      ).toEqual([]);
    });
  });

  describe("installment-cap", () => {
    const flaggedOf = (src: string) =>
      diagnosticsOf(src).filter((d) => d.ruleId === "installment-cap");

    it("errors on an over-cap schedule (issue #141 repro)", () => {
      const flagged = flaggedOf(`
        VEST OVER 999999999 months EVERY 1 month
      `);
      expect(flagged).toHaveLength(1);
      expect(flagged[0]).toEqual({
        ruleId: "installment-cap",
        message:
          "schedule expands to 999999999 installments, exceeds the limit of 10000",
        severity: "error",
        path: ["Program"],
      });
    });

    it("sums across PLUS statements", () => {
      // Each leg is under the cap; together they clear it.
      const flagged = flaggedOf(`
        VEST OVER 6000 days EVERY 1 day PLUS VEST OVER 6000 days EVERY 1 day
      `);
      expect(flagged).toHaveLength(1);
    });

    it("a schedule selector contributes its largest arm, not the sum", () => {
      expect(
        flaggedOf(`
          VEST EARLIER START OF (FROM DATE 2025-01-01 OVER 6000 days EVERY 1 day, FROM DATE 2025-06-01 OVER 6000 days EVERY 1 day)
        `),
      ).toEqual([]);
    });

    it("is clean exactly at the cap", () => {
      expect(
        flaggedOf(`
          VEST OVER 10000 days EVERY 1 day
        `),
      ).toEqual([]);
    });
  });

  // A duplicate selector arm can't reach `lintProgram` — the normalizer dedupes
  // it during canonicalization, before the linter runs. So the warning is raised
  // by the normalizer itself and surfaced through `lintText`, which threads a
  // sink into `normalizeProgram` and merges what comes back.
  describe("duplicate selector arm (via lintText)", () => {
    const lint = (src: string) => lintText(src).diagnostics;

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
      lintText(`VEST FROM EVENT m ${condition} ${OVER}`).diagnostics.filter(
        (d) => d.ruleId === "no-implicit-mixed-boolean",
      );

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

  // When `parse` throws inside `lintText`, the catch turns it into a single
  // diagnostic. A located peggy syntax error becomes a `syntax-error` with a loc
  // and a code frame, both derived from the dsl-owned decoder.
  describe("lintText catch path (syntax error)", () => {
    it("yields one located syntax-error diagnostic with a code frame", () => {
      const { diagnostics } = lintText("this is not vestlang");
      expect(diagnostics).toHaveLength(1);
      const d = diagnostics[0];
      expect(d.ruleId).toBe("syntax-error");
      expect(typeof d.loc?.start.line).toBe("number");
      expect(d.codeFrame).toBeDefined();
      expect(d.codeFrame?.length).toBeGreaterThan(0);
    });
  });
});
