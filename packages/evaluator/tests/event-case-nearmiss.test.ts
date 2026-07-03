// #407 — event-id case near-miss advisory.
//
// Event ids match case-sensitively while DSL keywords don't, so a firing keyed
// `ipo` never satisfies a gate that references `IpO`; the schedule just pends with
// no signal. The evaluator now adds an `event-firing-case-mismatch` warning when a
// referenced id has no exact firing but a case-only twin among the firings. The
// warning is purely additive: matching and resolution are unchanged, the grant
// still pends — we only gain the advisory.

import { describe, it, expect } from "vitest";
import type { Finding, ResolutionContextInput } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/index.js";

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const ctx = (
  events: Record<string, string | undefined> = {},
): ResolutionContextInput => ({
  grantDate: "2025-01-01",
  events,
  grantQuantity: 1200,
});

const caseFindings = (findings: Finding[]) =>
  findings.filter((f) => f.kind === "event-firing-case-mismatch");

describe("#407 — event-id case near-miss warning", () => {
  // AC#1 — the repro warns, naming both ids, and resolution is untouched.
  it("flags a referenced id whose only firing differs by case, still pending", () => {
    const result = evaluateProgram(
      prog("VEST FROM EVENT IpO OVER 12 months EVERY 1 month"),
      ctx({ ipo: "2025-06-01" }),
    );

    expect(caseFindings(result.findings)).toEqual([
      {
        kind: "event-firing-case-mismatch",
        severity: "warning",
        referenced: "IpO",
        fired: "ipo",
      },
    ]);

    // The advisory does not resolve the gate or invalidate the schedule — the
    // referenced `IpO` is still unfired, so the start stays pending.
    expect(result.resolvesTo.pending).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "IpO",
    });
  });

  // AC#2 — an exact-case firing is the control: no warning, and the 12 dated
  // installments resolve unchanged.
  it("does not warn (and resolves fully) on an exact-case firing", () => {
    const result = evaluateProgram(
      prog("VEST FROM EVENT ipo OVER 12 months EVERY 1 month"),
      ctx({ ipo: "2025-06-01" }),
    );

    expect(caseFindings(result.findings)).toEqual([]);
    expect(result.resolvesTo.status).toBe("template");
    expect(result.resolvesTo.installments).toHaveLength(12);
  });

  // AC#3 — a legitimately-unfired event has no case twin, so it must not warn:
  // this is normal pending, not a near-miss. (The precision that keeps it quiet.)
  it("does not warn when the referenced event has no firing at all", () => {
    const noFiring = evaluateProgram(
      prog("VEST FROM EVENT ipo OVER 12 months EVERY 1 month"),
      ctx({}),
    );
    expect(caseFindings(noFiring.findings)).toEqual([]);

    // An unrelated firing is no twin either — still no warning.
    const unrelated = evaluateProgram(
      prog("VEST FROM EVENT ipo OVER 12 months EVERY 1 month"),
      ctx({ acquisition: "2025-06-01" }),
    );
    expect(caseFindings(unrelated.findings)).toEqual([]);
  });

  // AC#4 — the warning rides the resolvesTo arm only. The firing-blind storable
  // verdict compares against no firings, so it can never carry the near-miss. (The
  // helper is only ever fed `ctxInput.events` on the resolvesTo path; the
  // storable context drops `events` entirely.) Findings sit top-level off
  // resolvesTo, but pin the storable verdict itself stays a clean template.
  it("the storable verdict carries no such warning", () => {
    const result = evaluateProgram(
      prog("VEST FROM EVENT IpO OVER 12 months EVERY 1 month"),
      ctx({ ipo: "2025-06-01" }),
    );
    // Storable is firing-blind — an unfired EVENT start is a storable template,
    // and no firing comparison happens there to produce a case finding.
    expect(result.storable.status).toBe("template");
    // The one finding that exists comes from the resolvesTo arm.
    expect(caseFindings(result.findings)).toHaveLength(1);
  });

  // AC#5 — two reference sites for the same id collapse to one finding (the
  // collector dedupes per distinct id), not one per site.
  it("warns once per distinct referenced id, not once per reference site", () => {
    // `IpO` appears twice — once as the start anchor, once as the gate reference —
    // so the walk collects two reference sites for the one id.
    const result = evaluateProgram(
      prog("VEST FROM EVENT IpO BEFORE EVENT IpO OVER 12 months EVERY 1 month"),
      ctx({ ipo: "2025-06-01" }),
    );
    expect(caseFindings(result.findings)).toEqual([
      {
        kind: "event-firing-case-mismatch",
        severity: "warning",
        referenced: "IpO",
        fired: "ipo",
      },
    ]);
  });

  // AC#6 — among several firings only the case-twin flags; the unrelated firing
  // produces nothing.
  it("flags only the case-twin firing among several", () => {
    const result = evaluateProgram(
      prog("VEST FROM EVENT IpO OVER 12 months EVERY 1 month"),
      ctx({ ipo: "2025-06-01", acquisition: "2025-07-01" }),
    );
    expect(caseFindings(result.findings)).toEqual([
      {
        kind: "event-firing-case-mismatch",
        severity: "warning",
        referenced: "IpO",
        fired: "ipo",
      },
    ]);
  });

  // A named-but-unfired (`undefined`-valued) firing is still a case twin worth
  // flagging — we read the supplied keys, not just the ones with a date.
  it("flags a case-twin firing even when its value is undefined", () => {
    const result = evaluateProgram(
      prog("VEST FROM EVENT IpO OVER 12 months EVERY 1 month"),
      ctx({ ipo: undefined }),
    );
    expect(caseFindings(result.findings)).toEqual([
      {
        kind: "event-firing-case-mismatch",
        severity: "warning",
        referenced: "IpO",
        fired: "ipo",
      },
    ]);
  });

  // AC#7 — the advisory is purely additive. A `IpO` reference with an `ipo` firing
  // pends exactly as it would with no firing at all (the case-twin never satisfies
  // the gate), so every part of the result except `findings` must match the
  // no-firing control: installments, blockers, both verdicts, absenceAssumptions.
  it("leaves resolvesTo, blockers and verdicts unchanged (advisory is additive)", () => {
    const warned = evaluateProgram(
      prog("VEST FROM EVENT IpO OVER 12 months EVERY 1 month"),
      ctx({ ipo: "2025-06-01" }),
    );

    // With `IpO` unfired the schedule pends exactly as it would with no firing at
    // all — the near-miss firing changes nothing but the findings list.
    const noFiring = evaluateProgram(
      prog("VEST FROM EVENT IpO OVER 12 months EVERY 1 month"),
      ctx({}),
    );

    expect(warned.resolvesTo).toEqual(noFiring.resolvesTo);
    expect(warned.storable).toEqual(noFiring.storable);
    expect(warned.absenceAssumptions).toEqual(noFiring.absenceAssumptions);
    // The lone difference: the warned run carries the advisory, the unfired run does not.
    expect(caseFindings(warned.findings)).toHaveLength(1);
    expect(caseFindings(noFiring.findings)).toHaveLength(0);
  });
});
