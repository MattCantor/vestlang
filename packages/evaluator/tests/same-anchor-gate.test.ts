import { describe, it, expect } from "vitest";
import type { ResolutionContextInput } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/index.js";

// A gate that pins both sides to the same non-date anchor and can never be
// satisfied is impossible regardless of firings. The shared node hook classifies
// it IMPOSSIBLE, which drives BOTH verdicts: the firing-blind `storable` (the bug:
// it used to store a template) and the closed-world `resolvesTo` (which tightens a
// not-yet-decided gate straight to impossible, mirroring the empty-date-window
// behavior).

const evaluate = (src: string, events: Record<string, string> = {}) =>
  evaluateProgram(normalizeProgram(parse(src)), {
    grantDate: "2025-01-01",
    grantQuantity: 1200,
    events,
  } satisfies ResolutionContextInput);

// The referenced event fires here for the positive/negative cases that supply it.
const FIRED = "2026-03-01";

describe("same-anchor gate — storable is impossible (was wrongly a template)", () => {
  it("an event strictly after itself is impossible to store", () => {
    const out = evaluate(
      "VEST FROM EVENT ipo STRICTLY AFTER EVENT ipo OVER 12 months EVERY 1 month",
      { ipo: FIRED },
    );
    expect(out.storable.status).toBe("impossible");
  });

  it("an event strictly before itself is impossible to store", () => {
    const out = evaluate(
      "VEST FROM EVENT ipo STRICTLY BEFORE EVENT ipo OVER 12 months EVERY 1 month",
      { ipo: FIRED },
    );
    expect(out.storable.status).toBe("impossible");
  });

  it("an empty window bounded above and below by one event is impossible to store", () => {
    const out = evaluate(
      "VEST FROM EVENT s AFTER EVENT b AND STRICTLY BEFORE EVENT b OVER 12 months EVERY 1 month",
      { b: FIRED },
    );
    expect(out.storable.status).toBe("impossible");
  });

  it("a determinately-positive offset ahead of the same event is impossible to store", () => {
    const out = evaluate(
      "VEST FROM EVENT a AFTER EVENT a + 1 month OVER 12 months EVERY 1 month",
      { a: FIRED },
    );
    expect(out.storable.status).toBe("impossible");
  });

  it("a self-referential cliff gate makes the schedule impossible to store", () => {
    const out = evaluate(
      "VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF EVENT v STRICTLY AFTER EVENT v",
      { v: FIRED },
    );
    expect(out.storable.status).toBe("impossible");
  });
});

describe("same-anchor gate — resolvesTo tightens before the event is decided", () => {
  // With the event unsupplied, the gate isn't "waiting" — it's already dead: no
  // firing could ever satisfy it. So resolvesTo is impossible, not pending. This is
  // the same tightening an empty date window already gets.
  it("flips a not-yet-fired self-reference from pending to impossible", () => {
    const out = evaluate(
      "VEST FROM EVENT ipo STRICTLY AFTER EVENT ipo OVER 12 months EVERY 1 month",
      {},
    );
    expect(out.resolvesTo.status).toBe("impossible");
    expect(out.resolvesTo.dead.length).toBeGreaterThan(0);
    expect(out.resolvesTo.pending).toHaveLength(0);
  });

  it("dies an empty-window subject even before the subject event fires", () => {
    // Only the bound event `b` is supplied; the subject `s` never fires. Without
    // the fix `s` would pend forever — now the gate is impossible up front.
    const out = evaluate(
      "VEST FROM EVENT s AFTER EVENT b AND STRICTLY BEFORE EVENT b OVER 12 months EVERY 1 month",
      { b: FIRED },
    );
    expect(out.resolvesTo.status).toBe("impossible");
  });
});

describe("same-anchor gate — satisfiable gates stay storable templates", () => {
  it("a non-strict self-comparison holds and vests the full schedule", () => {
    const out = evaluate(
      "VEST FROM EVENT ipo AFTER EVENT ipo OVER 12 months EVERY 1 month",
      { ipo: FIRED },
    );
    expect(out.storable.status).toBe("template");
    expect(out.resolvesTo.status).toBe("template");
    const resolved = out.resolvesTo.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    expect(resolved).toHaveLength(12);
  });

  it("a determinately-negative delta is storable", () => {
    const out = evaluate(
      "VEST FROM EVENT a STRICTLY AFTER EVENT a - 1 day OVER 12 months EVERY 1 month",
      { a: FIRED },
    );
    expect(out.storable.status).toBe("template");
  });

  it("the BEFORE side of a positive delta is storable", () => {
    const out = evaluate(
      "VEST FROM EVENT a STRICTLY BEFORE EVENT a + 1 month OVER 12 months EVERY 1 month",
      { a: FIRED },
    );
    expect(out.storable.status).toBe("template");
  });

  // The static analysis can't decide a mixed-sign offset delta, so it abstains and
  // the schedule stays a storable template. (Its resolvesTo is legitimately
  // impossible for this actual firing — the orthogonal closed-world path rejecting
  // the concrete date — which is exactly why the firing-blind analysis must abstain.)
  it("abstains firing-blind on an indeterminate offset delta (storable template)", () => {
    const out = evaluate(
      "VEST FROM EVENT a AFTER EVENT a + 1 month - 29 days OVER 12 months EVERY 1 month",
      { a: FIRED },
    );
    expect(out.storable.status).toBe("template");
  });
});
