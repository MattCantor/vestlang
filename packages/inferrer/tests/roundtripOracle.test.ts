import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  EvaluatedSchedule,
  Installment,
  OCTDate,
  VestingDayOfMonth,
  OCFVestingTermsV2,
} from "@vestlang/types";
import { inferSchedule } from "../src/index.js";
import { aggregateByDate, evalUnder, resolvedStream } from "./helpers.js";
import {
  AXES,
  CLEAN_TRIPWIRE_CASES,
  EXCLUDED_SEEDS,
  gridCases,
  SEED_CASES,
  type CaseParams,
  type OracleCase,
} from "./roundtripOracle.gen.js";

/*
 * Round-trip oracle for the inferrer — `evaluate ∘ infer = id`.
 *
 * For each generated single-schedule DSL template we run the round trip a real
 * consumer takes: evaluate the template, infer a program back from its tranche
 * stream, then re-evaluate that inferred program through the INDEPENDENT public
 * pipeline (parse → normalizeProgram → evaluateProgram). The verdict is read off
 * that re-evaluation's `resolution`, never off the inferrer's self-reported
 * residual — grading the inferrer against its own collapse number would be
 * circular.
 *
 * Each case lands in one of three structural buckets:
 *   - clean              recovered status "template", recovered canonical template
 *                        deep-equals the original's, projection matches. The
 *                        genuine identity.
 *   - structural-failure recovered status is not "template" (over this corpus:
 *                        events-only). The core inversion gap.
 *   - ambiguous-recovery recovered *a* template, but a DIFFERENT one that projects
 *                        the same stream (the cliff-vs-pulse taste call lives here).
 *                        Recorded, never auto-failed.
 *
 * The two non-clean buckets are frozen in a committed partition snapshot
 * (__snapshots__/roundtrip-oracle.partition.snap). That file is the actual
 * product: it characterizes the gap over THIS grid for single-schedule,
 * fully-resolved templates — not "the true failure set".
 *
 * Cross-package tripwire: the snapshot pins recovered DSL and canonical
 * templates, so a deliberate change in evaluator / primitives / render / dsl /
 * normalizer / @vestlang/types (the canonical shape — in active convergence with
 * the OCF proposal, draft PR #130 on OCF-Composed-Schemas) will diff it. That
 * diff is intended characterization signal — re-bless with `vitest -u`, it is not
 * a mislocated break here.
 */

type Projection = { date: OCTDate; total: number }[];
type Bucket = "clean" | "structural-failure" | "ambiguous-recovery";

// A finer split of ambiguous-recovery. `dom-convention-only` means the recovered
// template equals the original once `vesting_day_of_month` is stripped from every
// segment on both sides. The difference there is only an explicitness artifact:
// the evaluator stamps `vesting_day_of_month` onto a segment only when the
// context's policy differs from the default, so the original eval (run under a
// stamped policy) carries it while the recovered eval (run under the searched
// policy that resolves to the omitted default) does not — not a genuinely
// different schedule (#506). `shape-diff` is a real structural divergence (the
// cliff-vs-pulse taste call, an OVER/EVERY reshape, and the like).
type AmbiguousSubBucket = "dom-convention-only" | "shape-diff";

const PARTITION_PATH = fileURLToPath(
  new URL("./__snapshots__/roundtrip-oracle.partition.snap", import.meta.url),
);

// ---- comparators ------------------------------------------------------------

// `evalUnder`, `resolvedStream`, and the per-date aggregation live in ./helpers.ts,
// shared with the crash-containment suite. `aggregateProjection` is that shared
// aggregator, typed to this file's `Projection`.
const aggregateProjection = (
  stream: { date: OCTDate; amount: number }[],
): Projection => aggregateByDate(stream);

// Locale-independent string order, so the committed golden file's entry ordering
// can't churn across CI environments with different ICU collations — the file
// needs one fixed deterministic order. Plain `.sort()` on strings is already
// code-unit, so the sibling id arrays below stay consistent with this.
const byCodeUnit = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

// The one projection comparator and the one template comparator. Exact, never
// "close enough" — both are node:util's isDeepStrictEqual: order-sensitive on
// arrays (statement order matters), order-insensitive on keys, strict on
// primitives. One notion of "equal" everywhere.
function projectionsEqual(a: Projection, b: Projection): boolean {
  return isDeepStrictEqual(a, b);
}
function templatesEqual(a: OCFVestingTermsV2, b: OCFVestingTermsV2): boolean {
  return isDeepStrictEqual(a, b);
}

// Deep copy with `vesting_day_of_month` removed from every scheduled segment, so a
// template that differs ONLY in whether it carries the day-of-month policy
// compares equal. structuredClone keeps the originals (serialized in full, dom and
// all) untouched.
function stripDom(t: OCFVestingTermsV2): OCFVestingTermsV2 {
  const clone = structuredClone(t);
  for (const st of clone.statements) {
    if ("schedule" in st && st.schedule)
      delete st.schedule.vesting_day_of_month;
  }
  return clone;
}

// The dom-agnostic template comparator used to sub-bucket ambiguous-recovery.
function templatesEqualModuloDom(
  a: OCFVestingTermsV2,
  b: OCFVestingTermsV2,
): boolean {
  return isDeepStrictEqual(stripDom(a), stripDom(b));
}

// ---- generation / pruning ---------------------------------------------------

// The generator prune rule: wrap the whole parse → normalize → evaluate in
// try/catch — a bad point can fail at PARSE ("OVER must be a multiple of EVERY"),
// not only at evaluate — and admit only a `template`-status result whose every
// installment is RESOLVED. Anything else is pruned (returns null), never asserted.
function attemptTemplate(
  dsl: string,
  grantDate: OCTDate,
  total: number,
  dom: VestingDayOfMonth,
): {
  template: OCFVestingTermsV2;
  stream: { date: OCTDate; amount: number }[];
} | null {
  let sched: EvaluatedSchedule;
  try {
    sched = evalUnder(dsl, grantDate, total, dom);
  } catch {
    return null;
  }
  const r = sched.resolution;
  const items: Installment[] = r.installments;
  if (r.status !== "template" || !items.every((i) => i.state === "RESOLVED"))
    return null;
  return { template: r.template, stream: resolvedStream(sched) };
}

// Cliff-ness read straight off the source DSL — the one place it's always true,
// for a grid point and a hand-pinned seed alike — rather than re-deriving it from
// params (and special-casing the seed by name).
function isCliffCase(c: OracleCase): boolean {
  return /\bCLIFF\b/i.test(c.dsl);
}

// A genuine round-down-ripple tail: the installments after the cliff lump, where
// at least one differs from the modal tail rate.
function hasRippleTail(stream: { amount: number }[]): boolean {
  if (stream.length < 2) return false;
  const tail = stream.slice(1).map((s) => s.amount);
  const counts = new Map<number, number>();
  for (const v of tail) counts.set(v, (counts.get(v) ?? 0) + 1);
  let modal = tail[0];
  let best = 0;
  for (const [v, n] of counts)
    if (n > best) {
      best = n;
      modal = v;
    }
  return tail.some((v) => v !== modal);
}

// ---- the oracle run ---------------------------------------------------------

interface OracleEntry {
  id: string;
  params: CaseParams;
  grantDate: OCTDate;
  bucket: Bucket;
  // Only set for ambiguous-recovery; null otherwise.
  subBucket: AmbiguousSubBucket | null;
  originalStatus: string;
  recoveredStatus: string;
  originalDsl: string;
  recoveredDsl: string;
  originalTemplate: OCFVestingTermsV2;
  recoveredTemplate: OCFVestingTermsV2 | null;
  projectionDivergence: { original: Projection; recovered: Projection } | null;
  // Internal, not serialized into the snapshot.
  ripple: boolean;
  projMatch: boolean;
  originalAggregated: Projection;
}

interface OracleRun {
  entries: OracleEntry[];
  byId: Map<string, OracleEntry>;
  prunedIds: string[];
}

function runCase(c: OracleCase): OracleEntry | null {
  const admitted = attemptTemplate(c.dsl, c.grantDate, c.total, c.dom);
  if (!admitted) return null;

  const originalAggregated = aggregateProjection(admitted.stream);
  const inferred = inferSchedule({
    tranches: admitted.stream,
    grantDate: c.grantDate,
  });

  let recoveredStatus: string;
  let recoveredTemplate: OCFVestingTermsV2 | null = null;
  let recoveredAggregated: Projection;
  try {
    const recSched = evalUnder(
      inferred.dsl,
      c.grantDate,
      c.total,
      inferred.diagnostics.vestingDayOfMonth,
    );
    const rr = recSched.resolution;
    recoveredStatus = rr.status;
    recoveredTemplate = rr.status === "template" ? rr.template : null;
    recoveredAggregated = aggregateProjection(resolvedStream(recSched));
  } catch {
    // Defensive: infer emits valid DSL over this corpus, so this never fires —
    // but a future infer change that emits unparseable output should read as a
    // structural failure, not crash the sweep.
    recoveredStatus = "ERROR";
    recoveredAggregated = [];
  }

  const projMatch = projectionsEqual(originalAggregated, recoveredAggregated);

  let bucket: Bucket;
  if (
    recoveredStatus === "template" &&
    recoveredTemplate !== null &&
    templatesEqual(recoveredTemplate, admitted.template) &&
    projMatch
  )
    bucket = "clean";
  else if (recoveredStatus !== "template") bucket = "structural-failure";
  else bucket = "ambiguous-recovery";

  // Split ambiguous-recovery: a recovery that differs from the original only by
  // the day-of-month explicitness artifact vs a genuine structural reshape.
  const subBucket: AmbiguousSubBucket | null =
    bucket === "ambiguous-recovery" && recoveredTemplate !== null
      ? templatesEqualModuloDom(recoveredTemplate, admitted.template) &&
        projMatch
        ? "dom-convention-only"
        : "shape-diff"
      : null;

  return {
    id: c.id,
    params: c.params,
    grantDate: c.grantDate,
    bucket,
    subBucket,
    originalStatus: "template",
    recoveredStatus,
    originalDsl: c.dsl,
    recoveredDsl: inferred.dsl,
    originalTemplate: admitted.template,
    // Already null for structural-failure (no template arm was read); the
    // different template for ambiguous-recovery; the equal one for clean.
    recoveredTemplate,
    projectionDivergence: projMatch
      ? null
      : { original: originalAggregated, recovered: recoveredAggregated },
    ripple: isCliffCase(c) && hasRippleTail(admitted.stream),
    projMatch,
    originalAggregated,
  };
}

function runOracle(): OracleRun {
  const all = [...gridCases(), ...SEED_CASES, ...CLEAN_TRIPWIRE_CASES];
  const entries: OracleEntry[] = [];
  const prunedIds: string[] = [];
  for (const c of all) {
    const e = runCase(c);
    if (e) entries.push(e);
    else prunedIds.push(c.id);
  }
  return {
    entries,
    byId: new Map(entries.map((e) => [e.id, e])),
    prunedIds,
  };
}

// ---- snapshot serialization -------------------------------------------------

// `includeSubBucket` is set only for the ambiguous-recovery array — the
// structural-failure entries have no sub-bucket, so it stays off the wire there.
function serializeEntry(e: OracleEntry, includeSubBucket = false) {
  return {
    id: e.id,
    params: e.params,
    grantDate: e.grantDate,
    bucket: e.bucket,
    ...(includeSubBucket ? { subBucket: e.subBucket } : {}),
    originalStatus: e.originalStatus,
    recoveredStatus: e.recoveredStatus,
    originalDsl: e.originalDsl,
    recoveredDsl: e.recoveredDsl,
    originalTemplate: e.originalTemplate,
    recoveredTemplate: e.recoveredTemplate,
    projectionDivergence: e.projectionDivergence,
  };
}

function buildPartition(run: OracleRun): string {
  const byId = (a: OracleEntry, b: OracleEntry) => byCodeUnit(a.id, b.id);
  const clean = run.entries.filter((e) => e.bucket === "clean");
  const structuralFailure = run.entries
    .filter((e) => e.bucket === "structural-failure")
    .sort(byId);
  const ambiguousRecovery = run.entries
    .filter((e) => e.bucket === "ambiguous-recovery")
    .sort(byId);
  const ambiguousDomOnly = ambiguousRecovery.filter(
    (e) => e.subBucket === "dom-convention-only",
  ).length;

  const partition = {
    _comment:
      "Round-trip oracle partition: evaluate∘infer over single-schedule, fully-resolved DSL templates. The two non-clean buckets, every case, sorted by id. This is the characterized gap over THIS grid, not the true failure set. Re-bless with `vitest -u` when a deliberate cross-package change shifts it.",
    grid: {
      axes: AXES,
      admitted: run.entries.length,
      prunedCount: run.prunedIds.length,
      prunedIds: [...run.prunedIds].sort(),
    },
    summary: {
      totalAdmitted: run.entries.length,
      clean: clean.length,
      structuralFailure: structuralFailure.length,
      ambiguousRecovery: ambiguousRecovery.length,
      ambiguousDomOnly,
      ambiguousShapeDiff: ambiguousRecovery.length - ambiguousDomOnly,
      cleanIds: clean.map((e) => e.id).sort(),
    },
    excludedSeeds: EXCLUDED_SEEDS,
    structuralFailure: structuralFailure.map((e) => serializeEntry(e)),
    ambiguousRecovery: ambiguousRecovery.map((e) => serializeEntry(e, true)),
  };
  return JSON.stringify(partition, null, 2) + "\n";
}

// ---- tests ------------------------------------------------------------------

let run: OracleRun;

// One heavy sweep, memoized into the suite. A generous explicit timeout, though
// the analytic core's per-case cost is small (a handful of candidate evaluations);
// the observed wall time is well under this budget.
beforeAll(() => {
  run = runOracle();
}, 120_000);

describe("inferrer round-trip oracle — evaluate ∘ infer", () => {
  it("every admitted case projects equally and buckets into one of three", () => {
    expect(run.entries.length).toBeGreaterThan(200); // a few hundred admitted
    const buckets = new Set<Bucket>([
      "clean",
      "structural-failure",
      "ambiguous-recovery",
    ]);
    for (const e of run.entries) {
      // Projection equality is the guard on every admitted case: a verified
      // candidate reproduces the per-date totals exactly, and the literal fallback
      // is projection-lossless by construction.
      expect(e.projMatch).toBe(true);
      expect(buckets.has(e.bucket)).toBe(true);
    }
  });

  it("every axis value is covered, with a genuine cliff round-down ripple", () => {
    const grid = run.entries.filter(
      (
        e,
      ): e is OracleEntry & { params: Extract<CaseParams, { kind: "grid" }> } =>
        e.params.kind === "grid",
    );
    const seen = {
      offset: new Set(grid.map((e) => e.params.offset)),
      duration: new Set(grid.map((e) => e.params.duration)),
      cadence: new Set(grid.map((e) => e.params.cadence)),
      cliff: new Set(grid.map((e) => String(e.params.cliff))),
      total: new Set(grid.map((e) => e.params.total)),
      dom: new Set(grid.map((e) => e.params.dom)),
    };
    for (const v of AXES.offset) expect(seen.offset).toContain(v);
    for (const v of AXES.duration) expect(seen.duration).toContain(v);
    for (const v of AXES.cadence) expect(seen.cadence).toContain(v);
    for (const v of AXES.cliff) expect(seen.cliff).toContain(String(v));
    for (const v of AXES.total) expect(seen.total).toContain(v);
    for (const v of AXES.dom) expect(seen.dom).toContain(v);

    // At least one cliff case whose tail genuinely ripples (round-down).
    expect(run.entries.some((e) => e.ripple)).toBe(true);
  });

  it("the prune rule drops a non-generable point (parse-stage failure)", () => {
    // OVER must be a multiple of EVERY; 12 / 5 is a parse error, so the point is
    // pruned rather than asserted. Demonstrates the try/catch is non-vacuous even
    // though the curated v1 grid happens to admit every point.
    expect(
      attemptTemplate(
        "100 VEST OVER 12 months EVERY 5 months",
        "2024-01-01",
        100,
        "VESTING_START_DAY",
      ),
    ).toBeNull();
  });

  it("the cliff-ripple seed is a template that recovers non-clean", () => {
    const e = run.byId.get("seed-0-cliff-ripple");
    expect(e).toBeDefined();
    expect(e?.originalStatus).toBe("template");
    expect(e?.ripple).toBe(true);
    // Bucket is snapshot-recorded, not hard-asserted (a future rescue is a benign
    // snapshot diff) — but it must classify into a real bucket.
    expect(e?.bucket).toBeDefined();
  });

  it("the isolated-singles seed evaluates to a template of distinct lumps", () => {
    const e = run.byId.get("seed-1-isolated-singles");
    expect(e).toBeDefined();
    expect(e?.originalStatus).toBe("template");
    // Verified by evaluation: status template with the intended distinct RESOLVED
    // installments on distinct dates (the 137/891/42 shape — not a one-date
    // collapse, since each one-month segment advances the THEN tail by a month).
    expect(e?.originalAggregated).toEqual([
      { date: "2024-02-01", total: 137 },
      { date: "2024-03-01", total: 891 },
      { date: "2024-04-01", total: 42 },
    ]);
  });

  it("the non-clean buckets match the committed partition snapshot", async () => {
    await expect(buildPartition(run)).toMatchFileSnapshot(PARTITION_PATH);
  });

  it("named clean cases are hard-asserted clean, independent of the snapshot", () => {
    expect(CLEAN_TRIPWIRE_CASES.length).toBeGreaterThan(0); // tripwire can't be a no-op
    for (const c of CLEAN_TRIPWIRE_CASES) {
      const e = run.byId.get(c.id);
      expect(e, `${c.id} should be admitted`).toBeDefined();
      // This assertion can't be re-blessed by `vitest -u`: a slide clean →
      // structural-failure/ambiguous-recovery fails here regardless of the snapshot.
      expect(e?.bucket, `${c.id} should round-trip clean`).toBe("clean");
    }
  });

  it("the projection comparator sums same-date amounts and orders by date", () => {
    // The case the corpus never happens to hit but the comparator must get right:
    // two amounts on one date must ADD, not overwrite — a recovered cover can split
    // one input tranche across several same-date installments, and per-date totals
    // are the invariant.
    expect(
      aggregateProjection([
        { date: "2024-02-01", amount: 6 },
        { date: "2024-02-01", amount: 4 },
        { date: "2024-01-01", amount: 3 },
      ]),
    ).toEqual([
      { date: "2024-01-01", total: 3 },
      { date: "2024-02-01", total: 10 },
    ]);
  });

  it("'clean' requires EXACT template and projection equality, never close-enough", () => {
    const base: OCFVestingTermsV2 = {
      id: "resolved",
      object_type: "VESTING_TERMS",
      statements: [
        {
          order: 1,
          percentage: "1",
          schedule: { occurrences: 4, period: 1, period_type: "MONTHS" },
        },
      ],
    };
    const offByADigit: OCFVestingTermsV2 = {
      id: "resolved",
      object_type: "VESTING_TERMS",
      statements: [
        {
          order: 1,
          percentage: "0.9999999999",
          schedule: { occurrences: 4, period: 1, period_type: "MONTHS" },
        },
      ],
    };
    expect(templatesEqual(base, base)).toBe(true);
    expect(templatesEqual(base, offByADigit)).toBe(false);

    const p: Projection = [{ date: "2024-02-01", total: 100 }];
    const offByOne: Projection = [{ date: "2024-02-01", total: 101 }];
    expect(projectionsEqual(p, p)).toBe(true);
    expect(projectionsEqual(p, offByOne)).toBe(false);
  });

  it("the sub-bucket classifier separates a dom-only difference from a shape diff", () => {
    // Pins stripDom / templatesEqualModuloDom directly, so the dom-convention-only
    // vs shape-diff split holds independent of whatever the corpus happens to emit.
    const base: OCFVestingTermsV2 = {
      id: "resolved",
      object_type: "VESTING_TERMS",
      statements: [
        {
          order: 1,
          percentage: "1",
          schedule: { occurrences: 4, period: 1, period_type: "MONTHS" },
        },
      ],
    };
    // Identical schedule, but one segment carries an explicit day-of-month policy —
    // the explicitness artifact the sub-bucket has to see through.
    const domOnly: OCFVestingTermsV2 = {
      id: "resolved",
      object_type: "VESTING_TERMS",
      statements: [
        {
          order: 1,
          percentage: "1",
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            vesting_day_of_month: "LAST_DAY_OF_MONTH",
          },
        },
      ],
    };
    // A genuinely different grid (quarterly, not monthly): a real shape diff that
    // stripping the day-of-month can't reconcile.
    const shapeDiff: OCFVestingTermsV2 = {
      id: "resolved",
      object_type: "VESTING_TERMS",
      statements: [
        {
          order: 1,
          percentage: "1",
          schedule: { occurrences: 4, period: 3, period_type: "MONTHS" },
        },
      ],
    };

    // stripDom erases the artifact, so the dom-only pair collapses to the base.
    expect(stripDom(domOnly)).toEqual(stripDom(base));
    // dom-only ⇒ equal-modulo-dom (classifies dom-convention-only)...
    expect(templatesEqualModuloDom(base, domOnly)).toBe(true);
    // ...a real reshape stays unequal even with the day-of-month stripped (shape-diff).
    expect(templatesEqualModuloDom(base, shapeDiff)).toBe(false);
    // Exact equality still sees the artifact, so the split isn't vacuous.
    expect(templatesEqual(base, domOnly)).toBe(false);
  });
});
