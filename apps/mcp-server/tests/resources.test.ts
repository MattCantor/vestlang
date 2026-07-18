import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RESOURCES } from "../src/resources.js";

// Guards the wiring that started #44: a published MCP resource whose `path`
// silently points at a moved or deleted file. Every registered resource must
// resolve to a readable, non-empty file under the repo root. Mirrors the path
// resolution in registerResources (resources.ts).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("MCP resources", () => {
  it("registers at least one resource", () => {
    expect(RESOURCES.length).toBeGreaterThan(0);
  });

  it.each(RESOURCES.map((r) => [r.name, r.path] as [string, string]))(
    "%s resolves to a non-empty file",
    (_name, path) => {
      const text = readFileSync(resolve(REPO_ROOT, path), "utf8");
      expect(text.trim().length).toBeGreaterThan(0);
    },
  );

  // #469 — the evaluation doc is a live MCP resource that CI can't typecheck, so the
  // blocker shape it documents can silently drift from the type. Guard the migration:
  // the EVENT_NOT_YET_OCCURRED arm carries a nested `boundary?:`, not the old flat
  // `direction?:` / `inclusive?:` / `consequence?:` / `through?:` fields.
  it("documents the EVENT_NOT_YET_OCCURRED blocker with a nested boundary, not flat fields", () => {
    const evaluation = RESOURCES.find((r) => r.name === "evaluation");
    expect(evaluation).toBeDefined();
    const text = readFileSync(resolve(REPO_ROOT, evaluation!.path), "utf8");
    expect(text).toContain("boundary?:");
    // None of the four old flat fields may reappear as an optional blocker member.
    expect(text).not.toMatch(
      /\b(?:through|direction|inclusive|consequence)\?:/,
    );
  });
});

// The authoring recipe is a live MCP resource — a page that CI can't typecheck, so
// the facts it teaches can drift from the tools it choreographs without anything
// noticing. The presence test keeps the resource wired; the content test pins the
// exact strings below. Beyond those, the page must keep teaching all six of:
//   1. the propose→verify→refine loop;
//   2. the mapping from narrative phrases to observation kinds (tranche, balance);
//   3. the discrimination test, and that a match under the default tolerance is
//      weak evidence (tighten the tolerance or compare gaps);
//   4. the month-end / day-of-month wrinkle in both forms — a literal start caught
//      by lint, and an implicit start at a month-end grant date that lint can't see;
//   5. when NOT to use infer_schedule (its complete-grant assumption);
//   6. surfacing which parts of the final DSL rest on the narrative vs. the anchors.
// Those are diff-reviewed against the prose, not string-matched here.
describe("MCP resources — authoring recipe", () => {
  const authoring = RESOURCES.find(
    (r) => r.uri === "vestlang://docs/authoring",
  );
  // Read the page once; empty when the resource is gone, so both tests fail loud.
  const text = authoring
    ? readFileSync(resolve(REPO_ROOT, authoring.path), "utf8")
    : "";

  it("registers the authoring resource pointing at the recipe page", () => {
    expect(authoring).toBeDefined();
    expect(authoring!.name).toBe("authoring");
    expect(authoring!.path).toBe("apps/docs/docs/authoring.md");
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("keeps the exact facts the recipe page must state", () => {
    // The three tools the recipe choreographs.
    expect(text).toContain("vestlang_lint");
    expect(text).toContain("vestlang_verify_observations");
    expect(text).toContain("vestlang_infer_schedule");
    // The discrimination signal.
    expect(text).toContain("worstGap");
    // The month-end wrinkle: the lint ruleId for the literal case, and the
    // day-of-month convention that both cases name (the ruleId alone would miss
    // the implicit case, which never trips lint).
    expect(text).toContain("ambiguous-month-end-start");
    expect(text).toContain("LAST_DAY_OF_MONTH");
    // The completeness caveat, verbatim.
    expect(text).toContain("assumes the tranches are the complete grant");
    // The provenance section.
    expect(text).toMatch(/^#{1,3} .*Narrative vs\. anchors/im);
  });
});
