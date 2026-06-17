import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PersistedArtifact } from "@vestlang/evaluator";
import { runPersist, runRehydrate } from "../src/persist.js";
import { runResolveOffset } from "../src/resolve-offset.js";

// Crystallizes issue #296: the persistence/offset orchestrators surface every
// refusal as a structured PipelineError with the assigned ruleId, and every
// operator-facing message string is preserved verbatim from before the unification.
// The per-orchestrator suites (persist.test.ts, resolve-offset.test.ts) cover the
// success paths; this file is the witness table — one assertion per refusal site —
// plus the no-string-error-arm guard.

const srcUrl = (name: string) =>
  fileURLToPath(new URL(`../src/${name}`, import.meta.url));

describe("no orchestrator keeps a string error arm (AC#1)", () => {
  // The literal sweep the issue calls for: once the bespoke `error: string` arms
  // collapse onto Result<PipelineError>, the phrase must not appear in any of the
  // three sources.
  it.each(["persist.ts", "resolve-offset.ts", "parse.ts"])(
    "src/%s has zero `error: string` matches",
    (file) => {
      const text = readFileSync(srcUrl(file), "utf8");
      expect(text).not.toContain("error: string");
    },
  );
});

describe("persist refusals — structured, with verbatim messages (AC#2, #3, #7)", () => {
  // #1 — a syntax error in the DSL propagates the parser's own structured error
  // (input.dsl is parsed directly, no synthetic wrap), so the `loc` span still
  // points at the user's source.
  it("#1 parse failure propagates syntax-error WITH its loc", () => {
    const r = runPersist({
      dsl: "VEST FRO",
      grant_date: "2025-01-01",
      grant_quantity: 100,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("syntax-error");
    // The propagated parser error carries a source span.
    expect(r.error).toHaveProperty("loc");
    if (r.error.ruleId === "syntax-error") {
      expect(r.error.loc).toBeDefined();
      expect(r.error.loc?.start.line).toBe(1);
    }
  });

  // #2 — a lint error (an empty date window) is refused before evaluation under
  // the persist-not-storable umbrella, naming the diagnostic.
  it("#2 lint error → persist-not-storable, naming the diagnostic", () => {
    const r = runPersist({
      dsl: "VEST FROM EVENT ipo AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("persist-not-storable");
    expect(r.error.message).toMatch(/^Cannot persist: /);
    expect(r.error.message).toContain("unsatisfiable-date-window");
    expect(r.error.message).toMatch(/\.$/);
  });

  // #4 — a valid program that over-allocates (a clean single template) is caught
  // by the validity gate, sharing the persist-not-storable ruleId but witnessed by
  // its own "over-allocat" wording.
  it("#4 invalid findings → persist-not-storable, naming the over-allocation", () => {
    const r = runPersist({
      dsl: "6000 VEST FROM DATE 2025-01-01 OVER 1 YEAR EVERY 3 MONTHS",
      grant_date: "2025-01-01",
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("persist-not-storable");
    expect(r.error.message).toMatch(/^Cannot persist: /);
    expect(r.error.message).toContain("over-allocat");
  });

  // #5 — a non-template resolution shares the ruleId but is witnessed by its
  // distinct verbatim message.
  it("#5 non-template resolution → persist-not-storable, exact wording", () => {
    const r = runPersist({
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF EVENT ipo",
      grant_date: "2025-01-01",
      grant_quantity: 1000,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("persist-not-storable");
    expect(r.error.message).toContain(
      "Only a template-resolution program is storable as a persisted artifact",
    );
    expect(r.error.message).toContain(
      "Adjust the schedule so it collapses to a single canonical template.",
    );
  });
});

describe("rehydrate refusals — structured, with verbatim messages (AC#2, #3)", () => {
  const overAllocatingArtifact = (): PersistedArtifact => ({
    template: {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 4,
          period: 3,
          period_type: "MONTHS",
          percentage: { numerator: 5, denominator: 4 },
        },
      ],
    },
    runtime: { grantDate: "2025-01-01", startDate: "2025-01-01" },
  });

  // #6 — a hand-built artifact missing its stored grant date.
  it("#6 missing grant date → rehydrate-missing-grant-date, verbatim", () => {
    const r = runRehydrate({
      artifact: {
        template: { id: "t1", statements: [] },
        runtime: { startDate: "2025-01-01" },
      },
      grant_quantity: 400,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("rehydrate-missing-grant-date");
    expect(r.error.message).toBe(
      "Cannot rehydrate: the artifact's runtime is missing its stored grant date (runtime.grantDate). A persisted artifact always carries it; supply one built by vestlang_persist.",
    );
  });

  // #7 — an over-allocating template is refused up front (the #283/#226 gate),
  // before any projection materializes.
  it("#7 over-allocation → rehydrate-over-allocation, with the damaged-artifact tail", () => {
    const r = runRehydrate({
      artifact: overAllocatingArtifact(),
      grant_quantity: 4800,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("rehydrate-over-allocation");
    expect(r.error.message).toMatch(/^Cannot rehydrate: /);
    expect(r.error.message).toContain("125%");
    expect(r.error.message).toContain(
      "The artifact appears to be damaged; supply one built by vestlang_persist.",
    );
    // The over-vesting stream is never built.
    expect(r).not.toHaveProperty("projection");
  });

  // #8 — a corrupt stored event definition. The verbatim message names the event
  // and reads as a corruption refusal, without echoing the raw parser dump.
  it("#8 corrupt definition → rehydrate-corrupt-definition, verbatim", () => {
    const r = runRehydrate({
      artifact: {
        template: {
          id: "t1",
          statements: [
            {
              order: 1,
              vesting_base: { type: "EVENT", event_id: "evt_1" },
              occurrences: 4,
              period: 1,
              period_type: "MONTHS",
              percentage: { numerator: 1, denominator: 1 },
            },
          ],
        },
        runtime: { grantDate: "2025-01-01" },
        sidecar: { vestlang: { evt_1: { definition: "TOTALLY NOT DSL ((" } } },
      },
      grant_quantity: 400,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("rehydrate-corrupt-definition");
    expect(r.error.message).toBe(
      'Cannot rehydrate: the stored definition for event "evt_1" is corrupt or unparseable. The artifact appears to be damaged; supply one built by vestlang_persist.',
    );
    // The raw parser text stays off the operator-facing message.
    expect(r.error.message).not.toContain('Expected "DATE"');
  });
});

describe("offset refusals — structured, with verbatim messages (AC#2, #3, #4, #7)", () => {
  // #9 — the parse failure REWRAPS: it keeps the "Could not parse expression: "
  // prefix but omits `loc` (the parser ran over the synthetic `VEST FROM` wrap, so
  // a propagated span would be column-shifted and point at source the user never
  // typed). Contrast persist's #1, which propagates loc.
  it("#9 parse failure → syntax-error, prefixed message, NO loc (rewrap)", () => {
    const r = runResolveOffset({
      expr: "this is not vestlang",
      grant_date: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("syntax-error");
    expect(r.error.message).toMatch(/^Could not parse expression: /);
    expect(r.error).not.toHaveProperty("loc");
  });

  // #10 (len > 1) — a multi-statement input (a THEN tail parses to head + tail).
  it("#10 multi-statement → offset-not-single-expression, verbatim (len > 1)", () => {
    const r = runResolveOffset({
      expr: "EVENT a THEN 200 VEST OVER 12 months EVERY 1 month",
      grant_date: "2025-01-01",
      events: { a: "2025-03-01" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("offset-not-single-expression");
    expect(r.error.message).toBe(
      "Expected a single offset expression, got 2 statements",
    );
  });

  // #12 — an unresolved expression. The `unresolved` field is REQUIRED on this arm
  // (resolveVestingStart always produces a reason), and both message and field are
  // populated and carry the same reason.
  it("#12 unresolved → offset-unresolved, with the required `unresolved` field", () => {
    const r = runResolveOffset({
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("offset-unresolved");
    if (r.error.ruleId !== "offset-unresolved") return;
    // Both populated, both the same reason.
    expect(r.error.unresolved).toBeTruthy();
    expect(r.error.message).toBe(
      `Expression is unresolved: ${r.error.unresolved}`,
    );
    expect(r.error.unresolved).toBe("EVENT ipo");
  });
});

// #10 (len 0) and #11 (selector / chained head) are defensive guards inside
// runResolveOffset that no input can reach through the public function: the
// parser's Program rule always yields at least one statement (so length is never
// 0), and a Chain always begins with a non-chained head whose expr is a SCHEDULE
// (so neither `chained` nor a non-SCHEDULE expr can appear at index 0). We pin that
// unreachability — the inputs that would otherwise route there are turned away as
// parse errors first — so the guards stay justified without a fabricated witness.
describe("offset's len-0 / selector guards are unreachable through the wrap", () => {
  it("an empty expression is a parse error, never a length-0 program", () => {
    const r = runResolveOffset({ expr: "   ", grant_date: "2025-01-01" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("syntax-error");
  });

  it("a schedule-level selector doesn't parse after `VEST FROM`", () => {
    const r = runResolveOffset({
      expr: "EARLIER START OF ( EVENT a OVER 12 months EVERY 1 month, EVENT b OVER 12 months EVERY 1 month )",
      grant_date: "2025-01-01",
      events: { a: "2025-03-01", b: "2025-04-01" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("syntax-error");
  });
});
