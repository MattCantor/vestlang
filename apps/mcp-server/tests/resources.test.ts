import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VESTLANG_GRAMMAR_GUIDE } from "@vestlang/vestlang/authoring";
import { RESOURCES } from "../src/resources.js";
import { RESOURCE_DIR } from "../scripts/copy-resources.js";
import { RESOURCE_SOURCES, sourcePath } from "../scripts/resource-sources.js";

// Two lists describe the same seven resources: the shipped manifest (what the
// server registers and which file it reads) and the build-time source map (where
// each body is copied from). Neither knows about the other, so they are pinned
// against each other here.
describe("MCP resources", () => {
  it("registers at least one resource", () => {
    expect(RESOURCES.length).toBeGreaterThan(0);
  });

  it("names the same resources as the source map, in both directions", () => {
    expect(new Set(RESOURCES.map((r) => r.name))).toEqual(
      new Set(Object.keys(RESOURCE_SOURCES)),
    );
  });

  it.each(RESOURCES.map((r) => [r.name, r.file] as const))(
    "%s is copied to a non-empty file in the package",
    (_name, file) => {
      const text = readFileSync(join(RESOURCE_DIR, file), "utf8");
      expect(text.trim().length).toBeGreaterThan(0);
    },
  );

  // The grammar resource now serves the published guide; the docs-site page it
  // used to serve is a docs page and nothing more.
  it("sources no resource from the docs-site grammar page", () => {
    for (const source of Object.values(RESOURCE_SOURCES)) {
      if (source.from === "file") {
        expect(source.path).not.toContain("dsl_grammar");
      }
    }
  });

  // A rewritten line ending or a re-encoded body would be invisible to every
  // other check here. Both expectations are read independently of the copy
  // script's own helper, so a transcode inside it still shows up. This says
  // nothing about staleness — the copy runs in globalSetup, moments before this
  // reads it; turbo's inputs guard that.
  it("copies a docs page byte for byte", () => {
    expect(
      readFileSync(join(RESOURCE_DIR, "spec.md")).equals(
        readFileSync(sourcePath("spec")),
      ),
    ).toBe(true);
  });

  it("copies the published guide byte for byte", () => {
    expect(
      readFileSync(join(RESOURCE_DIR, "grammar.md")).equals(
        Buffer.from(VESTLANG_GRAMMAR_GUIDE, "utf8"),
      ),
    ).toBe(true);
  });
});

// The pages below are live MCP resources that CI can't typecheck, so what they
// document can drift from the code. These read the SOURCE page, not the copy —
// a stale page has to fail here, and the copy is only ever as good as its source.
describe("MCP resources — page currency", () => {
  // #469 — guard the migration of the EVENT_NOT_YET_OCCURRED blocker: its arm
  // carries a nested `boundary?:`, not the old flat `direction?:` /
  // `inclusive?:` / `consequence?:` / `through?:` fields.
  it("documents the EVENT_NOT_YET_OCCURRED blocker with a nested boundary, not flat fields", () => {
    const text = readFileSync(sourcePath("evaluation"), "utf8");
    expect(text).toContain("boundary?:");
    expect(text).not.toMatch(
      /\b(?:through|direction|inclusive|consequence)\?:/,
    );
  });
});

// The authoring recipe teaches facts about the tools it choreographs, and those
// can drift without anything noticing. The strings below are pinned; beyond them
// the page must keep teaching all six of:
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
  const text = readFileSync(sourcePath("authoring"), "utf8");

  it("registers the authoring resource against the recipe page", () => {
    const authoring = RESOURCES.find(
      (r) => r.uri === "vestlang://docs/authoring",
    );
    expect(authoring).toBeDefined();
    expect(authoring!.name).toBe("authoring");
    expect(RESOURCE_SOURCES.authoring).toEqual({
      from: "file",
      path: "apps/docs/docs/authoring.md",
    });
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
