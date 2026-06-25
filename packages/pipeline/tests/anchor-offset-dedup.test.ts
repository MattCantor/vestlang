// The `vestingStart + one-positive-duration` shape predicate lives in exactly one
// place — `@vestlang/walk`'s `systemAnchorOffset` (#187). Three consumers route
// through it: the evaluator's cliff lowering, render's `FROM`/`CLIFF` sugar, and
// the cliff-exceeds-span linter rule. #378 broke that by re-inlining a privately
// named copy (`systemAnchorOffsetLocal`) in the evaluator; #421 deletes it.
//
// This guard catches a *structural* re-inline, not a name. A name- or
// import-presence check would have passed for #378 itself — it kept the
// `@vestlang/walk` import and added a copy alongside. So the load-bearing
// assertions below are: (1) no consumer source carries the predicate's distinctive
// clause conjunction (any divergent copy reproduces it, whatever it's spelled), and
// (2) each consumer imports the shared `systemAnchorOffset`. Static source reads
// follow the `sentinels-removed.test.ts` precedent (a relative-URL `readFileSync`)
// rather than a tree-wide grep, which would self-match this test body.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relFromTests: string): string =>
  readFileSync(fileURLToPath(new URL(relFromTests, import.meta.url)), "utf8");

// The three consumer sites and their source, read once.
const consumers = {
  "evaluator cliff lowering": read("../../evaluator/src/resolve/cliff.ts"),
  "render FROM/CLIFF sugar": read("../../render/src/to-doc.ts"),
  "cliff-exceeds-span linter rule": read(
    "../../linter/src/rules/cliff-exceeds-span.ts",
  ),
};

// The one place the predicate is allowed to live, read so the guard can anchor on
// it: if the shared body is ever respelled, the clause fingerprint below drifts
// and this positive check fails loudly — rather than the consumer checks silently
// passing on a fingerprint that no longer matches anything.
const sharedPredicateSource = read("../../walk/src/index.ts");

// The clauses that make up the shared predicate's guard. A re-inlined copy (like
// #378's `systemAnchorOffsetLocal`) reproduces all of them regardless of the
// variable name it binds the node to. The pair `.offsets.length !== 1` +
// `.sign === "PLUS"` is the distinctive fingerprint of the one-positive-duration
// shape-match — no unrelated predicate in these files carries it — so the guard
// fires on the *conjunction*, not any single clause (e.g. render's
// `isDefaultVestingStart` legitimately uses `type !== "NODE"` and `condition`).
// Whitespace is squashed first so a reformatted copy can't slip the match.
const squash = (s: string) => s.replace(/\s+/g, "");
const predicateClauses = [
  '.type!=="NODE"',
  ".offsets.length!==1",
  '.sign==="PLUS"',
];

// True when `src` carries the full clause conjunction (a re-inline of the body).
const reInlinesPredicate = (src: string): boolean => {
  const squashed = squash(src);
  return predicateClauses.every((c) => squashed.includes(c));
};

describe("the vestingStart-offset shape predicate is consolidated (#187/#421)", () => {
  it("the shared @vestlang/walk predicate still matches the clause fingerprint", () => {
    // Anchor: the fingerprint must match its real home, or the consumer checks
    // below are vacuously green against a stale fingerprint.
    expect(reInlinesPredicate(sharedPredicateSource)).toBe(true);
  });

  it("no consumer source re-copies the distinctive shape-match clauses", () => {
    for (const [site, src] of Object.entries(consumers)) {
      // A consumer that routes through the shared export carries none of these
      // together; a re-inline carries the whole conjunction. Flag the full copy.
      expect(reInlinesPredicate(src), `${site} re-inlines the predicate`).toBe(
        false,
      );
    }
  });

  it("no consumer keeps the #378 `systemAnchorOffsetLocal` symbol", () => {
    for (const [site, src] of Object.entries(consumers)) {
      expect(
        src,
        `${site} still references systemAnchorOffsetLocal`,
      ).not.toContain("systemAnchorOffsetLocal");
    }
  });

  it("each consumer imports the shared systemAnchorOffset from @vestlang/walk", () => {
    for (const [site, src] of Object.entries(consumers)) {
      expect(
        src,
        `${site} does not use the shared systemAnchorOffset`,
      ).toContain("systemAnchorOffset");
      expect(src, `${site} does not import from @vestlang/walk`).toContain(
        "@vestlang/walk",
      );
    }
  });

  // AC6: the PeriodTag → PeriodType widening at the cliff's period_type assignment
  // is safe only because YEARS can't occur (vestlang source never emits a YEARS
  // duration). Pin the clarifying note the deleted local carried — match the
  // specific phrasing, not a bare YEARS token, so an unrelated YEARS occurrence
  // can't vacuously satisfy it.
  it("the cliff lowering keeps the YEARS-can't-occur widening note", () => {
    expect(consumers["evaluator cliff lowering"]).toMatch(
      /never emits a YEARS duration/,
    );
  });
});
