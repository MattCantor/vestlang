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
// A vesting percentage is stored as a fixed-point Numeric decimal, so a repeating
// cliff share like 1/3 only reaches the ten-place grid ("0.3333333334"). At a
// large enough grant no point on that grid lands the lump the exact share calls
// for. The guard already reported this on the stored-template arm; #384 extends it
// to a schedule that resolves to the events arm (two overlapping grids) or the
// unresolved arm (a resolved sibling beside a pending one) — both of which read the
// stored cliff decimal back through the live projection.
//
// The guard on these arms is CLIFF-ONLY: the statement percentage stays an exact
// internal fraction (only the cliff round-trips through the stored Numeric), so
// only the cliff is analyzed. And it fires only for cliffs the projection actually
// materializes — a resolved cliff sitting under a still-pending start is never read
// live, so warning there would be a false positive.

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const precisionFindings = (result: { findings: Finding[] }) =>
  result.findings.filter((f) => f.kind === "precision-insufficient");

// The canonical reproduction: two overlapping absolute-start grids (so the program
// can't be one template and routes to events-only), the first a 1/3 cliff on a
// half-of-grant statement. At ordinary grants the stored cliff decimal lands the
// lump exactly; the guard has something to say only once the grant is large enough
// that no ten-place decimal can (30 billion shares behind the cliff, below).
const CANONICAL =
  "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF 1 month PLUS 0.5 VEST FROM DATE 2021-06-01 OVER 3 months EVERY 1 month";

const baseCtx = (grantQuantity: number) => ({
  grantDate: "2019-01-01",
  events: {},
  grantQuantity,
});

describe("#384 — events-arm cliff precision guard", () => {
  it("emits one finding with the right shape where ten places cannot land the lump", () => {
    // 60 billion shares puts 30 billion behind the 1/3 cliff, where the window
    // around the exact lump is narrower than 10⁻¹⁰ and no storable decimal hits it.
    const result = resolveToCore(prog(CANONICAL), baseCtx(60000000000));
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
    expect(f.percentage).toBe("0.3333333334");
    expect(f.inferred).toEqual({ numerator: 1, denominator: 3 });
    // No decimal is offered: none lands the count, which is the whole finding.
    expect(f.recommended).toBeUndefined();
  });

  it("reports the statement's share count as the basis, floor(0.5 × 60000000000)", () => {
    const result = resolveToCore(prog(CANONICAL), baseCtx(60000000000));
    const findings = precisionFindings(result);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.shareCount).toBe(30000000000);
  });

  it("stays silent at an ordinary grant, where the stored cliff lands the lump exactly", () => {
    // The same schedule at 72,000: a third of 36,000 is exactly 12,000 and the
    // stored decimal pays it, so there is nothing to report.
    const result = resolveToCore(prog(CANONICAL), baseCtx(72000));
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
    if (result.kind !== "events") return;
    const lump = result.installments
      .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
      .find((i) => i.date === "2020-02-01");
    expect(lump?.amount).toBe(12000);
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

// #386 — the guard's verdict reproduces the realizer's grant-scale lump (one floor
// of stmtFraction × dec(cliff) × grant), so a lossy basis (stmtFraction × grant
// non-integer) doesn't fool it in either direction. Both cliffs here LEAD their
// merged position — the sibling grid starts 2021-06-01, well after the cliff date —
// so the exact grant-scale single-floor verdict applies.
describe("#386 — lossy-basis cliff precision (the grant-scale verdict)", () => {
  const isResolved = (i: { state: string }): i is ResolvedInstallment =>
    i.state === "RESOLVED";

  it("a half-of-grant statement at an odd grant keeps its exact lump and stays silent", () => {
    // floor(0.5 × 72001) = 36000 would be a lossy basis to floor against a second
    // time. The realized leading lump is floor(0.5 × dec(1/3) × 72001) = 12,000 =
    // floor(0.5 × 1/3 × 72001), so nothing is reported.
    const result = resolveToCore(prog(CANONICAL), baseCtx(72001));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;

    expect(precisionFindings(result)).toHaveLength(0);

    const resolved = result.installments.filter(isResolved);
    const firstGridLump = resolved.find((i) => i.date === "2020-02-01");
    expect(firstGridLump?.amount).toBe(12000);
  });

  it("a 2/3 cliff on a half-of-grant statement pays the exact 335 of 1005", () => {
    // Two thirds of half of 1,005 shares is 335 exactly. The stored cliff decimal
    // rounds up to "0.6666666667", so the lump lands on 335 — where rounding the
    // stored value down would have paid 334.
    //
    // (This fixture used to discriminate the grant-scale basis from a pre-floored
    // per-statement one, because the two disagreed about that lost share. Both
    // bases now agree, so the discrimination has moved elsewhere; what it pins here
    // is the share that is no longer lost.)
    const dsl =
      "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF 2 months PLUS 0.5 VEST FROM DATE 2021-06-01 OVER 3 months EVERY 1 month";
    const result = resolveToCore(prog(dsl), baseCtx(1005));
    expect(result.kind).toBe("events");
    if (result.kind !== "events") return;

    expect(precisionFindings(result)).toHaveLength(0);

    const resolved = result.installments.filter(isResolved);
    const firstGridLump = resolved.find((i) => i.date === "2020-03-01");
    expect(firstGridLump?.amount).toBe(335);
  });
});

// #386 AC3 — the non-leading (path-dependent) cliff. When a sibling event sorts
// strictly before the cliff lump, the realized lump depends on what vested ahead of
// it, so no per-statement basis is exact. The guard errs conservative: it warns
// whenever it can't prove the stored decimal IS the cliff's exact share, accepting
// an over-warn to guarantee it never stays silent on a real loss — but stays SILENT
// when the decimal is provably exact (a terminating cliff), so the over-warn doesn't
// become an unconditional warn.
describe("#386 — non-leading cliff is warned conservatively (AC3)", () => {
  const isResolved = (i: { state: string }): i is ResolvedInstallment =>
    i.state === "RESOLVED";

  // Statement 1 (no cliff, order 1) emits an event on 2020-02-01; statement 2's 2/3
  // cliff lump lands on 2020-03-01. In the global (date, order, occurrence) walk the
  // 2020-02-01 event sorts before the lump → non-leading. Two absolute-date grids →
  // events arm.
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
    expect(f.percentage).toBe("0.6666666667");
    // The conservative shape: recommended omitted (no fixed decimal is provably
    // right for a path-dependent lump), conservative flag set — distinguishing it
    // from a not-representable finding, which also has no recommended. (The distinct
    // rendered message is asserted in pipeline's findings.test.ts, the home of
    // formatFinding — evaluator can't import pipeline without a dependency cycle.)
    expect(f.recommended).toBeUndefined();
    expect(f.conservative).toBe(true);
  });

  it("warns without moving the lump it warns about", () => {
    const result = resolveToCore(prog(NON_LEADING), baseCtx(1005));
    if (result.kind !== "events") return;
    const resolved = result.installments.filter(isResolved);
    // The stmt-2 cliff lump on 2020-03-01 is the 335 the realizer folds there.
    const lump = resolved.find(
      (i) => i.date === "2020-03-01" && i.amount === 335,
    );
    expect(lump).toBeDefined();
  });

  // The silent leg of the conservative rule: a non-leading lump with a *terminating*
  // cliff decimal draws NO warning. Statement 2's cliff is a clean 1/2 ("0.5") — an
  // OVER-2/CLIFF-1-month grid folds 1 of 2 occurrences — and statement 1's first
  // installment sorts before it (same date 2020-02-01, lower order), so the lump is
  // non-leading. A terminating decimal is provably exact, so the guard stays silent
  // even on the conservative branch. (This pins that "warn unless provably exact" is
  // not an unconditional warn — a regression dropping the exact/terminating early
  // return would fail here while every other non-leading test still passed.)
  const NON_LEADING_TERMINATING =
    "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2020-01-01 OVER 2 months EVERY 1 month CLIFF 1 month";

  it("stays silent for a non-leading lump whose cliff decimal terminates", () => {
    const result = resolveToCore(prog(NON_LEADING_TERMINATING), baseCtx(1005));
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
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
      // Large enough that no storable decimal lands the 1/3 lump — the regime
      // where the guard has something to say.
      grantQuantity: 60000000000,
    });
    expect(result.kind).toBe("unresolved");
    const findings = precisionFindings(result);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.path).toEqual(["statements", 0, "cliff"]);
    expect(f.percentage).toBe("0.3333333334");
    expect(f.shareCount).toBe(30000000000);
    expect(f.inferred).toEqual({ numerator: 1, denominator: 3 });
    expect(f.recommended).toBeUndefined();
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

// #386 — an EVENT_HELD cliff is EXCLUDED from the precision pass entirely. The
// precision guard only sizes a cliff whose lump is folded from the *stored decimal*.
// An EVENT_HELD cliff is never that lump: fired, it folds proportionally (the lump =
// pre-cliff occurrences / N, computed from grid accrual — the stored decimal is never
// read, so it can't mis-round); unfired, the grid is held and no lump materializes at
// all. So a precision warning on an EVENT_HELD cliff is a pure false positive — the
// exact failure this issue exists to kill — and the pass gates on `state === "RESOLVED"`.
describe("#386 — EVENT_HELD cliffs are excluded (no false positive)", () => {
  // `CLIFF LATER OF(1 month, EVENT m)` decomposes into a time baseline (the 1/3 cliff,
  // stored "0.3333333333") + an event hold. The time arm's decimal is over-precise and
  // WOULD warn if analyzed, but the realized lump folds proportionally, so it must not.
  it("a fired event-held cliff's over-precise time baseline draws no finding", () => {
    const dsl =
      "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF LATER OF(1 month, EVENT m) PLUS 0.5 VEST FROM DATE 2021-06-01 OVER 3 months EVERY 1 month";
    const result = resolveToCore(prog(dsl), {
      grantDate: "2019-01-01",
      events: { m: "2020-02-15" }, // m fired
      grantQuantity: 72000,
    });
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
  });

  // The same hold left unfired — the grid is held, the cliff lump never materializes,
  // so its stored decimal can't misallocate anything. (The materialize gate keys on the
  // start date, which IS dated here, so the EVENT_HELD state-gate is what excludes it.)
  it("an unfired event-held cliff's time baseline draws no finding", () => {
    const dsl =
      "0.5 VEST FROM DATE 2020-01-01 OVER 36 months EVERY 12 months CLIFF LATER OF(12 months, EVENT ipo) PLUS 0.5 VEST FROM DATE 2021-06-01 OVER 12 months EVERY 1 month";
    const result = resolveToCore(prog(dsl), {
      grantDate: "2019-01-01",
      events: {}, // ipo unfired
      grantQuantity: 36000,
    });
    expect(result.kind).toBe("events");
    expect(precisionFindings(result)).toHaveLength(0);
  });
});
