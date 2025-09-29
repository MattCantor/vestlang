import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl"; // parser from your DSL package
import type { Statement } from "@vestlang/dsl";
import { lint } from "../src/index";

function issuesOf(src: string) {
  const stmt = parse(src) as Statement;
  return lint(stmt);
}

function codesOf(src: string): string[] {
  return issuesOf(src)
    .map((i) => i.code)
    .sort();
}

describe("@vestlang/linter", () => {
  describe("FROM-term predicate lints", () => {
    it("flags redundant multiple AFTER predicates", () => {
      const codes = codesOf(`
        VEST SCHEDULE FROM EVENT grant
          AFTER DATE 2025-01-01 AND AFTER DATE 2025-02-01
      `);
      expect(codes).toContain("LINT-PRED-REDUNDANT");
    });

    it("flags redundant multiple BEFORE predicates", () => {
      const codes = codesOf(`
        VEST SCHEDULE FROM DATE 2025-12-31
          BEFORE DATE 2025-12-30 AND BEFORE DATE 2025-12-01
      `);
      expect(codes).toContain("LINT-PRED-REDUNDANT");
    });

    it("suggests BETWEEN when AFTER and BEFORE share the same STRICTLY flag", () => {
      const issues = issuesOf(`
        VEST SCHEDULE FROM EVENT grant
          AFTER DATE 2025-01-01 AND BEFORE DATE 2025-12-31
      `);
      expect(issues.some((i) => i.code === "LINT-PRED-CONJ-TO-BETWEEN")).toBe(
        true,
      );
      const fix =
        issues.find((i) => i.code === "LINT-PRED-CONJ-TO-BETWEEN")?.fix ?? "";
      expect(fix).toMatch(/BETWEEN/i);
      expect(fix).not.toMatch(/STRICTLY BETWEEN/i);
    });

    it("suggests STRICTLY BETWEEN when both sides are STRICTLY", () => {
      const issue = issuesOf(`
        VEST SCHEDULE FROM EVENT grant
          STRICTLY AFTER DATE 2025-01-01 AND STRICTLY BEFORE DATE 2025-12-31
      `).find((i) => i.code === "LINT-PRED-CONJ-TO-BETWEEN");
      expect(issue).toBeTruthy();
      expect(issue!.fix).toMatch(/STRICTLY BETWEEN/i);
    });

    it("flags date-only BETWEEN with start > end", () => {
      const issues = issuesOf(`
        VEST SCHEDULE FROM EVENT grant
          BETWEEN DATE 2025-12-31 AND DATE 2025-01-01
      `);
      expect(issues.some((i) => i.code === "LINT-PRED-DATE-ORDER")).toBe(true);
    });

    it("flags STRICTLY BETWEEN with equal endpoints as empty set", () => {
      const issues = issuesOf(`
        VEST SCHEDULE FROM EVENT grant
          STRICTLY BETWEEN DATE 2025-01-01 AND DATE 2025-01-01
      `);
      const match = issues.find((i) => i.code === "LINT-PRED-EQUAL-STRICT");
      expect(match).toBeTruthy();
      expect(match!.message).toMatch(/empty set/i);
    });
  });

  describe("EarlierOf/LaterOf list hygiene", () => {
    it("flags duplicate items inside FROM EARLIER OF", () => {
      const issues = issuesOf(`
        VEST SCHEDULE FROM EARLIER OF (DATE 2025-01-01, DATE 2025-01-01)
      `);
      expect(issues.some((i) => i.code === "LINT-LIST-DUP")).toBe(true);
    });

    it("flags singleton list inside FROM LATER OF", () => {
      const issues = issuesOf(`
        VEST SCHEDULE FROM LATER OF (EVENT ipo)
      `);
      expect(issues.some((i) => i.code === "LINT-LIST-SINGLETON")).toBe(true);
    });

    it("flags duplicate schedules inside top-level EARLIER OF (Expr)", () => {
      const issues = issuesOf(`
        VEST EARLIER OF (
          SCHEDULE FROM DATE 2025-01-01,
          SCHEDULE FROM DATE 2025-01-01
        )
      `);
      expect(issues.some((i) => i.code === "LINT-LIST-DUP")).toBe(true);
    });

    it("flags singleton top-level LATER OF (Expr)", () => {
      const issues = issuesOf(`
        VEST LATER OF (
          SCHEDULE FROM DATE 2025-01-01
        )
      `);
      expect(issues.some((i) => i.code === "LINT-LIST-SINGLETON")).toBe(true);
    });
  });

  describe("CLIFF predicate lints", () => {
    it("applies predicate checks to CLIFF Qualified anchors", () => {
      const issues = issuesOf(`
        VEST SCHEDULE
        CLIFF EVENT hire AFTER DATE 2025-01-01 AND AFTER DATE 2025-02-01
      `);
      expect(issues.some((i) => i.code === "LINT-PRED-REDUNDANT")).toBe(true);
      // and path should mention .cliff
      expect(issues.some((i) => (i.path ?? "").includes(".cliff"))).toBe(true);
    });
  });

  describe("Schedule-level suggestions (normalized)", () => {
    it("flags explicit OVER 0 / EVERY 0 with Zero cliff as redundant", () => {
      const issues = issuesOf(`
        VEST SCHEDULE OVER 0 days EVERY 0 days
      `);
      const hit = issues.find((i) => i.code === "LINT-SCHED-REDUNDANT-ZERO");
      expect(hit).toBeTruthy();
      expect(hit!.fix).toMatch(/omit/i);
    });
  });
});
