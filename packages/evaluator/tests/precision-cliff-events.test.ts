import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  Finding,
  OCTDate,
  Program,
  ResolvedInstallment,
  VestingNode,
  VestingPeriod,
} from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";
import {
  makeDuration,
  makeSingletonNode,
  makeSingletonSchedule,
  makeVestingBaseDate,
  makeVestingBaseEvent,
  makeVestingBaseVestingStart,
} from "./helpers";

// Issue #384 — the precision guard fires on the events / unresolved arms too.
//
// #359 stores a vesting percentage as a fixed-point Numeric decimal, so a
// repeating cliff share like 1/3 can only be written truncated ("0.3333333333").
// At some grant sizes that truncation allocates a share or two off the intended
// fraction. The guard already warned about this on the stored-template arm; #384
// extends it to a schedule that resolves to the events arm (two overlapping
// grids) or the unresolved arm (a resolved sibling beside a pending one) — both
// of which read the truncated cliff decimal back through the live projection.
//
// The guard on these arms is CLIFF-ONLY: the statement percentage stays an exact
// internal fraction (only the cliff round-trips through the truncating Numeric),
// so only the cliff is analyzed. And it fires only for cliffs the projection
// actually materializes — a resolved cliff sitting under a still-pending start is
// never read live, so warning there would be a false positive.

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const precisionFindings = (result: { findings: Finding[] }) =>
  result.findings.filter((f) => f.kind === "precision-insufficient");

// The canonical reproduction: two overlapping absolute-start grids (so the program
// can't be one template and routes to events-only), the first a 1/3 cliff on a
// half-of-grant statement. At 72,000 shares the first statement covers 36,000, and
// floor("0.3333333333" × 36000) = 11,999 — one share short of the intended 12,000.
const CANONICAL =
  "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF 1 month PLUS 0.5 VEST FROM DATE 2021-06-01 OVER 3 months EVERY 1 month";

const baseCtx = (grantQuantity: number) => ({
  grantDate: "2019-01-01",
  events: {},
  grantQuantity,
});

describe("#384 — events-arm cliff precision guard", () => {
  it("AC1: the canonical events-arm reproduction emits one finding with the right shape", () => {
    const result = resolveToCore(prog(CANONICAL), baseCtx(72000));
    expect(result.kind).toBe("events");
    if (result.kind === "events") {
      expect(result.reason.kind).toBe("OVERLAPPING_ABSOLUTE_STARTS");
    }
    const findings = precisionFindings(result);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.severity).toBe("warning");
    // The finding addresses the first statement's cliff. The "statements" segment
    // is the shared path convention even though no template.statements array exists
    // on a non-template verdict; the index is the position in the resolutions.
    expect(f.path).toEqual(["statements", 0, "cliff"]);
    expect(f.percentage).toBe("0.3333333333");
    expect(f.inferred).toEqual({ numerator: 1, denominator: 3 });
    // The shortest decimal that would have landed the intended 12,000 — set the
    // same way the template arm produces it.
    expect(f.recommended).toBe("0.33334");
  });

  it("AC2: the finding's share basis is the statement's share count, floor(0.5 × 72000) = 36000", () => {
    const result = resolveToCore(prog(CANONICAL), baseCtx(72000));
    const findings = precisionFindings(result);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.shareCount).toBe(36000);
  });

  it("AC3: an exact-basis cliff (1/2) in the events arm emits no precision finding", () => {
    // Same overlapping-grid shape, but the first statement's cliff is a clean 1/2
    // ("0.5") — a terminating decimal that allocates exactly — so no warning.
    const dsl =
      "0.5 VEST FROM DATE 2020-01-01 OVER 2 months EVERY 1 month CLIFF 1 month PLUS 0.5 VEST FROM DATE 2021-06-01 OVER 3 months EVERY 1 month";
    const result = resolveToCore(prog(dsl), baseCtx(72000));
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
  });

  it("AC4: a pending-event-start clause carrying an over-precise cliff is silent", () => {
    // The first clause's start waits on the unfired `ipo`, so its 1/3 cliff is a
    // RESOLVED (same-unit duration) cliff that the live projection never reads —
    // the grid is held until ipo fires. Warning there would be a false positive, so
    // the guard stays silent even though the stored decimal is over-precise.
    const dsl =
      "0.5 VEST FROM EVENT ipo OVER 36 months EVERY 12 months CLIFF 12 months PLUS 0.5 VEST FROM DATE 2026-01-01 OVER 36 months EVERY 12 months";
    const result = resolveToCore(prog(dsl), {
      grantDate: "2025-01-01",
      events: {}, // ipo unfired
      grantQuantity: 72000,
    });
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
  });

  it("AC5: a genuinely-repeating statement fraction is not flagged (the guard is cliff-only)", () => {
    // A 24,000-of-72,000 quantity split gives the first statement an exact internal
    // fraction of 1/3 — genuinely repeating. (A literal "0.3333…" portion would be
    // parsed to an exact fraction instead, so the quantity split is the way to get a
    // truly repeating statement fraction.) With no cliff there is nothing the
    // cliff-only pass can analyze, so the repeating *statement* fraction draws no
    // warning — only a cliff percentage round-trips through the truncating Numeric
    // on this path.
    const dsl =
      "24000 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month PLUS 48000 VEST FROM DATE 2021-06-01 OVER 3 months EVERY 1 month";
    const result = resolveToCore(prog(dsl), baseCtx(72000));
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
  });

  it("AC8a: a zero-share grant produces no precision finding and does not throw", () => {
    // grant 0 short-circuits the whole pass before any per-statement work: the
    // analyzer throws on a non-positive share count, so the pass bails out up front.
    const result = resolveToCore(prog(CANONICAL), baseCtx(0));
    expect(precisionFindings(result)).toHaveLength(0);
  });

  it("AC8b: a positive grant where a clause's share basis floors to 0 is skipped, not thrown", () => {
    // The other zero-basis path: the grant is positive (so the up-front short-circuit
    // doesn't fire and the per-statement loop runs), but floor(0.5 × 1) = 0 for each
    // half-of-grant clause. The cliff is the same over-precise 1/3 that WOULD warn at
    // a positive basis — so this isolates the per-clause skip (a statement covering no
    // shares has no cliff lump to misallocate), proving the analyzer is never called
    // with a 0 share count rather than the grant-level bail-out masking it.
    const result = resolveToCore(prog(CANONICAL), baseCtx(1));
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
  });
});

// #386 — the guard's verdict now reproduces the realizer's grant-scale lump (one
// floor of stmtFraction × dec(cliff) × grant), so a lossy basis (stmtFraction ×
// grant non-integer) no longer fools it in either direction. Both cliffs here LEAD
// their merged position — the sibling grid starts 2021-06-01, well after the cliff
// date — so the exact grant-scale single-floor verdict applies. (These two were
// #384 characterization tests pinning the old double-floor behaviour; flipped to
// correctness here, the gap they tracked is closed.)
describe("#386 — lossy-basis cliff precision (the grant-scale verdict)", () => {
  const isResolved = (i: { state: string }): i is ResolvedInstallment =>
    i.state === "RESOLVED";

  it("AC7a: false positive killed — the correct lump draws no warning (grant 72001)", () => {
    // floor(0.5 × 72001) = 36000 was the old basis, double-flooring "0.3333333333"
    // to 11,999 and warning. The realized leading lump is floor(0.5 × 0.3333333333 ×
    // 72001) = 12,000 = floor(0.5 × 1/3 × 72001) — exact — so the grant-scale verdict
    // is now SILENT (verified by vestlang_evaluate: lump 12,000 on 2020-02-01).
    const result = resolveToCore(prog(CANONICAL), baseCtx(72001));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;

    expect(precisionFindings(result)).toHaveLength(0);

    // The allocation is byte-identical — this is a warning-only change.
    const resolved = result.installments.filter(isResolved);
    const firstGridLump = resolved.find((i) => i.date === "2020-02-01");
    expect(firstGridLump?.amount).toBe(12000);
  });

  it("AC7b: false negative killed — the truncating lump now warns (grant 1005)", () => {
    // A 2/3 cliff ("0.6666666666") on a 1/2 statement. The realized leading lump is
    // floor(0.5 × 0.6666666666 × 1005) = 334, but the exact-fraction ideal is
    // floor(0.5 × 2/3 × 1005) = 335 — the stored decimal drops a share. The old
    // per-statement double floor (floor(2/3 × 502) = 334 = floor(0.5 × 1005)-basis)
    // matched the realized 334 and stayed silent; the grant-scale verdict sees 334 ≠
    // 335 and now WARNS. (vestlang_evaluate: lump 334 on 2020-03-01.)
    const dsl =
      "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF 2 months PLUS 0.5 VEST FROM DATE 2021-06-01 OVER 3 months EVERY 1 month";
    const result = resolveToCore(prog(dsl), baseCtx(1005));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;

    const findings = precisionFindings(result);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.severity).toBe("warning");
    expect(f.path).toEqual(["statements", 0, "cliff"]);
    expect(f.percentage).toBe("0.6666666666");
    // Leading lump → the exact-path finding carries a real recommendation, not the
    // conservative shape.
    expect(f.conservative).toBeUndefined();

    // Allocation byte-identical.
    const resolved = result.installments.filter(isResolved);
    const firstGridLump = resolved.find((i) => i.date === "2020-03-01");
    expect(firstGridLump?.amount).toBe(334);
  });
});

// #386 AC3 — the non-leading (path-dependent) cliff. When a sibling event sorts
// strictly before the cliff lump, the realized lump depends on what vested ahead of
// it (here 334 leading, 335 with one sibling preceding, 334 with two — see the
// contract), so no per-statement basis is exact. The guard errs conservative: it
// warns whenever it can't prove the stored decimal exact, accepting an over-warn to
// guarantee it never stays silent on a real loss.
describe("#386 — non-leading cliff is warned conservatively (AC3)", () => {
  const isResolved = (i: { state: string }): i is ResolvedInstallment =>
    i.state === "RESOLVED";

  // Statement 1 (no cliff, order 1) emits an event on 2020-02-01; statement 2's 2/3
  // cliff lump lands on 2020-03-01. In the global (date, order, occurrence) walk the
  // 2020-02-01 event sorts before the lump → non-leading. Two absolute-date grids →
  // events arm. (vestlang_evaluate: stmt-2 lump 334 on 2020-03-01.)
  const NON_LEADING =
    "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF 2 months";

  it("warns conservatively with recommended omitted and a path-dependent message", () => {
    const result = resolveToCore(prog(NON_LEADING), baseCtx(1005));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;

    const findings = precisionFindings(result);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.severity).toBe("warning");
    // The cliff is statement 2 (index 1).
    expect(f.path).toEqual(["statements", 1, "cliff"]);
    expect(f.percentage).toBe("0.6666666666");
    // The conservative shape: recommended omitted (the leading-basis recommendation
    // wouldn't match the path-dependent lump), conservative flag set — distinguishing
    // it from a not-representable finding, which also has no recommended. (The
    // distinct rendered message is asserted in pipeline's findings.test.ts, the home
    // of formatFinding — evaluator can't import pipeline without a dependency cycle.)
    expect(f.recommended).toBeUndefined();
    expect(f.conservative).toBe(true);
  });

  it("leaves the allocation byte-identical (warning-only)", () => {
    const result = resolveToCore(prog(NON_LEADING), baseCtx(1005));
    if (result.kind !== "events") return;
    const resolved = result.installments.filter(isResolved);
    // The stmt-2 cliff lump on 2020-03-01 is the 334 the realizer folds there.
    const lump = resolved.find(
      (i) => i.date === "2020-03-01" && i.amount === 334,
    );
    expect(lump).toBeDefined();
  });
});

// AC9 — the unresolved arm's resolved-sibling path. The public DSL routes an
// over-precise resolved cliff to the events/template arm first, so this defensive
// branch is exercised in isolation with a hand-built Program: a fully-resolved
// dated sibling (its 1/3 cliff materializes through resolvedInstallments) beside a
// statically-void sibling (which poisons the build to the unresolved arm without
// making the whole program impossible).
describe("#384 — unresolved-arm resolved-sibling cliff precision (AC9)", () => {
  // `EVENT a BEFORE DATE deadline` — void once a fires after the deadline.
  const eventBeforeDate = (
    event: string,
    deadline: OCTDate,
  ): VestingNode<"GRANT_DATE"> => ({
    type: "NODE",
    base: makeVestingBaseEvent(event),
    offsets: [],
    condition: {
      type: "ATOM",
      constraint: {
        type: "BEFORE",
        base: makeSingletonNode(makeVestingBaseDate(deadline)),
        strict: false,
      },
    },
  });

  const voidSibling = {
    type: "STATEMENT" as const,
    amount: { type: "PORTION" as const, numerator: 1, denominator: 2 },
    expr: makeSingletonSchedule(eventBeforeDate("a", "2025-01-01"), {
      type: "MONTHS",
      length: 12,
      occurrences: 2,
    }),
  };

  // A 1/3 cliff on a 3-month/1-month grid: the cliff date is one month past the
  // start, folding one of three occurrences.
  const oneThirdCliff = (cliffDate: OCTDate): VestingPeriod => ({
    type: "MONTHS",
    length: 1,
    occurrences: 3,
    cliff: makeSingletonNode(makeVestingBaseDate(cliffDate)),
  });

  it("a dated resolved sibling's over-precise cliff fires the warning", () => {
    const program: Program = [
      {
        type: "STATEMENT",
        amount: { type: "PORTION", numerator: 1, denominator: 2 },
        expr: makeSingletonSchedule(
          makeSingletonNode(makeVestingBaseDate("2020-01-01")),
          oneThirdCliff("2020-02-01"),
        ),
      },
      voidSibling,
    ];
    const result = resolveToCore(program, {
      grantDate: "2019-01-01",
      events: { a: "2025-06-01" },
      grantQuantity: 72000,
    });
    expect(result.kind).toBe("unresolved");
    const findings = precisionFindings(result);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.path).toEqual(["statements", 0, "cliff"]);
    expect(f.percentage).toBe("0.3333333333");
    expect(f.shareCount).toBe(36000);
    expect(f.inferred).toEqual({ numerator: 1, denominator: 3 });
    expect(f.recommended).toBe("0.33334");
  });

  it("a pending-event-start sibling in the same shape draws no warning", () => {
    // The first statement's start waits on the unfired `ipo`, so its same-unit
    // duration cliff is a RESOLVED cliff that never materializes (the grid is held).
    // It must NOT warn, exactly as on the events arm — only a dated start's cliff is
    // read live.
    const program: Program = [
      {
        type: "STATEMENT",
        amount: { type: "PORTION", numerator: 1, denominator: 2 },
        expr: makeSingletonSchedule(
          makeSingletonNode(makeVestingBaseEvent("ipo")),
          {
            type: "MONTHS",
            length: 1,
            occurrences: 3,
            cliff: makeSingletonNode(makeVestingBaseVestingStart(), [
              makeDuration(1, "MONTHS", "PLUS"),
            ]),
          },
        ),
      },
      voidSibling,
    ];
    const result = resolveToCore(program, {
      grantDate: "2019-01-01",
      events: { a: "2025-06-01" }, // ipo unfired
      grantQuantity: 72000,
    });
    expect(result.kind).toBe("unresolved");
    expect(precisionFindings(result)).toHaveLength(0);
  });
});
