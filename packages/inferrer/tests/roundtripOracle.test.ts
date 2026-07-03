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
import type { HypothesisFamily } from "../src/index.js";
import { aggregateByDate, evalUnder, resolvedStream } from "./helpers.js";
import {
  CLEAN_TRIPWIRE_CASES,
  EXCLUDED_SEEDS,
  gridCases,
  isCliffGeDuration,
  SEED_CASES,
  V2_AXIS_VALUES,
  V2_SLICE_TAGS,
  type CaseParams,
  type OracleCase,
} from "./roundtripOracle.gen.js";

/*
 * Round-trip oracle for the inferrer — `evaluate ∘ infer = id`, over the widened
 * (v2) characterization grid.
 *
 * For each generated single-schedule DSL template we run the round trip a real
 * consumer takes: evaluate the template, infer a program back from its tranche
 * stream, then re-evaluate that inferred program through the INDEPENDENT public
 * pipeline (parse → normalizeProgram → evaluateProgram). The verdict is read off
 * that re-evaluation's `resolvesTo`, never off the inferrer's self-reported
 * residual — grading the inferrer against its own collapse number would be
 * circular.
 *
 * Each case lands in one of three structural buckets:
 *   - clean              recovered status "template", recovered canonical template
 *                        deep-equals the original's, projection matches. The
 *                        genuine identity.
 *   - structural-failure recovered status is not "template". The core inversion
 *                        gap — empty on this grid, held at zero by a hard
 *                        assert.
 *   - ambiguous-recovery recovered *a* template, but a DIFFERENT one that projects
 *                        the same stream. Recorded, never auto-failed.
 *
 * The two non-clean buckets are frozen in a committed partition snapshot
 * (__snapshots__/roundtrip-oracle.partition.snap). The headline counts are scoped
 * to the GRID cases (the hand-pinned seeds and clean tripwires flow through the
 * same oracle but are exercised by their own named tests, not tallied into the
 * characterization). That file characterizes the gap over THIS grid for
 * single-schedule, fully-resolved templates — not "the true failure set".
 *
 * Snapshot slimming: naive full serialization of ~1,100 ambiguous entries runs
 * ~62k lines. The information-theoretically irreducible families (see below)
 * collapse to `id + expectedAmbiguous + subBucket`; the genuinely different-shape
 * recoveries stay full; and a guard forces at least one FULL exemplar per emitted
 * hypothesis family so every emission shape keeps a detailed, diffable entry.
 *
 * Cross-package tripwire: the full entries pin recovered DSL and canonical
 * templates, so a deliberate change in evaluator / primitives / render / dsl /
 * normalizer / @vestlang/types (the canonical shape) will diff them. Re-bless with
 * `vitest -u`; that diff is characterization signal, not a mislocated break here.
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

// The three information-theoretically irreducible families: cases no
// inferrer could ever recover clean, separated from "recoverable but differently
// shaped". fam1 is a pure params predicate; fam2 is sourced from the collision
// census; fam3 is exactly the dom-convention-only sub-bucket.
type ExpectedAmbiguous =
  | "cliff-ge-duration" // fam1: cliff ≥ duration — single-lump collapse
  | "erased-pre-grant-cliff" // fam2: observable collides with a cliff-less backdated reading
  | "dom-stamp-pair"; // fam3: the day-of-month explicitness artifact

const PARTITION_PATH = fileURLToPath(
  new URL("./__snapshots__/roundtrip-oracle.partition.snap", import.meta.url),
);

// ---- comparators ------------------------------------------------------------

const aggregateProjection = (
  stream: { date: OCTDate; amount: number }[],
): Projection => aggregateByDate(stream);

// Locale-independent string order, so the committed golden file's entry ordering
// can't churn across CI environments with different ICU collations.
const byCodeUnit = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

// The one projection comparator and the one template comparator. Exact, never
// "close enough" — both node:util's isDeepStrictEqual: order-sensitive on arrays,
// order-insensitive on keys, strict on primitives.
function projectionsEqual(a: Projection, b: Projection): boolean {
  return isDeepStrictEqual(a, b);
}
function templatesEqual(a: OCFVestingTermsV2, b: OCFVestingTermsV2): boolean {
  return isDeepStrictEqual(a, b);
}

// Deep copy with `vesting_day_of_month` removed from every scheduled segment, so a
// template that differs ONLY in whether it carries the day-of-month policy
// compares equal.
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
  const r = sched.resolvesTo;
  const items: Installment[] = r.installments;
  if (r.status !== "template" || !items.every((i) => i.state === "RESOLVED"))
    return null;
  return { template: r.template, stream: resolvedStream(sched) };
}

// Cliff-ness read straight off the source DSL.
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
  originalDom: VestingDayOfMonth;
  bucket: Bucket;
  subBucket: AmbiguousSubBucket | null;
  originalStatus: string;
  recoveredStatus: string;
  originalDsl: string;
  recoveredDsl: string;
  originalTemplate: OCFVestingTermsV2;
  recoveredTemplate: OCFVestingTermsV2 | null;
  projectionDivergence: { original: Projection; recovered: Projection } | null;
  // Which probe slices generated this case (for the per-slice coverage assert).
  slices: string[];
  // The hypothesis families the emitted program was tagged with (for the
  // full-exemplar-per-family snapshot guard). NOT reconstructable from the DSL.
  recoveredFamilies: HypothesisFamily[];
  // Original-case day-of-month is MINUS_ONE (drives the per-dom summary split).
  minusOneOriginal: boolean;
  // Irreducible-family annotations, filled in a second pass over the grid.
  fam1: boolean;
  fam2: boolean;
  fam3: boolean;
  // Primary tag (precedence fam1 > fam2 > fam3), or null when in no family.
  expectedAmbiguous: ExpectedAmbiguous | null;
  // Internal, not serialized.
  ripple: boolean;
  projMatch: boolean;
  originalAggregated: Projection;
}

interface OracleRun {
  entries: OracleEntry[];
  gridEntries: OracleEntry[];
  byId: Map<string, OracleEntry>;
  prunedIds: string[];
  ceiling: number;
  observableClasses: number;
  collisionClasses: number;
}

function isMinusOne(dom: VestingDayOfMonth): boolean {
  return dom === "VESTING_START_DAY_MINUS_ONE";
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
    const rr = recSched.resolvesTo;
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
    originalDom: c.dom,
    bucket,
    subBucket,
    originalStatus: "template",
    recoveredStatus,
    originalDsl: c.dsl,
    recoveredDsl: inferred.dsl,
    originalTemplate: admitted.template,
    recoveredTemplate,
    projectionDivergence: projMatch
      ? null
      : { original: originalAggregated, recovered: recoveredAggregated },
    slices: c.slices,
    recoveredFamilies: [...new Set(inferred.decomposition.map((d) => d.tag))],
    minusOneOriginal: isMinusOne(c.dom),
    fam1: false,
    fam2: false,
    fam3: false,
    expectedAmbiguous: null,
    ripple: isCliffCase(c) && hasRippleTail(admitted.stream),
    projMatch,
    originalAggregated,
  };
}

// The observable an inferrer sees: grant date + aggregated per-date stream. Two
// cases with the same observable are indistinguishable to any inferrer.
function observableKey(e: OracleEntry): string {
  return e.grantDate + "|" + JSON.stringify(e.originalAggregated);
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
  const gridEntries = entries.filter((e) => e.params.kind === "grid");

  // Observable classes over the grid: the collision census. Ceiling = at most ONE
  // distinct template per class can be clean, so the class's clean contribution
  // caps at the size of its largest same-template subgroup. Inferrer-independent
  // (it moves only with grid/engine changes) and definitionally in sync with the
  // partition it summarizes (computed from the run's own entries).
  const classes = new Map<string, OracleEntry[]>();
  for (const e of gridEntries) {
    const k = observableKey(e);
    const g = classes.get(k);
    if (g) g.push(e);
    else classes.set(k, [e]);
  }
  let ceiling = 0;
  let collisionClasses = 0;
  for (const members of classes.values()) {
    const distinct: OracleEntry[][] = [];
    for (const m of members) {
      const g = distinct.find((d) =>
        isDeepStrictEqual(d[0].originalTemplate, m.originalTemplate),
      );
      if (g) g.push(m);
      else distinct.push([m]);
    }
    ceiling += Math.max(...distinct.map((d) => d.length));
    if (distinct.length > 1) collisionClasses++;
  }

  // Which observable classes contain a cliff-less backdated reading — the source
  // for fam2 (erased pre-grant cliff): a cliff whose date fell on/before the grant
  // folds into a backdated cliff-less uniform, so its observable collides with one.
  const classHasClifflessBackdated = new Map<string, boolean>();
  for (const [k, members] of classes) {
    classHasClifflessBackdated.set(
      k,
      members.some(
        (m) =>
          m.params.kind === "grid" &&
          m.params.cliff === null &&
          m.params.offset !== "fromGrant",
      ),
    );
  }

  // Second pass: irreducible-family annotations (grid cases only).
  for (const e of gridEntries) {
    if (e.params.kind !== "grid") continue;
    e.fam1 = isCliffGeDuration(e.params);
    e.fam2 =
      e.params.cliff !== null &&
      (classHasClifflessBackdated.get(observableKey(e)) ?? false);
    e.fam3 = e.subBucket === "dom-convention-only";
    e.expectedAmbiguous = e.fam1
      ? "cliff-ge-duration"
      : e.fam2
        ? "erased-pre-grant-cliff"
        : e.fam3
          ? "dom-stamp-pair"
          : null;
  }

  return {
    entries,
    gridEntries,
    byId: new Map(entries.map((e) => [e.id, e])),
    prunedIds,
    ceiling,
    observableClasses: classes.size,
    collisionClasses,
  };
}

// ---- summary helpers --------------------------------------------------------

function bucketCounts(entries: OracleEntry[]) {
  return {
    admitted: entries.length,
    clean: entries.filter((e) => e.bucket === "clean").length,
    structuralFailure: entries.filter((e) => e.bucket === "structural-failure")
      .length,
    ambiguousDomOnly: entries.filter(
      (e) => e.subBucket === "dom-convention-only",
    ).length,
    ambiguousShapeDiff: entries.filter((e) => e.subBucket === "shape-diff")
      .length,
  };
}

// ---- snapshot serialization -------------------------------------------------

function serializeFull(e: OracleEntry, includeSubBucket = false) {
  return {
    id: e.id,
    params: e.params,
    grantDate: e.grantDate,
    bucket: e.bucket,
    ...(includeSubBucket ? { subBucket: e.subBucket } : {}),
    ...(e.expectedAmbiguous ? { expectedAmbiguous: e.expectedAmbiguous } : {}),
    originalStatus: e.originalStatus,
    recoveredStatus: e.recoveredStatus,
    originalDsl: e.originalDsl,
    recoveredDsl: e.recoveredDsl,
    originalTemplate: e.originalTemplate,
    recoveredTemplate: e.recoveredTemplate,
    projectionDivergence: e.projectionDivergence,
  };
}

// A tagged-irreducible entry: no inferrer could win it, and its full recovered
// shape is reconstructable (fam3's recoveredTemplate is stripDom(original)
// re-stamped; fam1/fam2 are the single-lump / cliff-less-fold collapses). Collapse
// to the identity + why-it-is-ambiguous, so the snapshot stays diffable at ~14k
// lines instead of ~62k.
function serializeCollapsed(e: OracleEntry) {
  return {
    id: e.id,
    expectedAmbiguous: e.expectedAmbiguous,
    subBucket: e.subBucket,
  };
}

const ALL_FAMILIES: HypothesisFamily[] = [
  "plain",
  "cliff",
  "fold",
  "then-segment",
  "literal",
];

/** Choose which ambiguous entries stay FULL: every entry in no irreducible family
 *  (the genuinely different-shape recoveries), plus a forced exemplar for any
 *  emitted hypothesis family not already represented among those — so every
 *  emitted hypothesis family keeps at least one detailed, diffable snapshot entry. */
function fullExemplarIds(ambiguous: OracleEntry[]): Set<string> {
  const sorted = [...ambiguous].sort((a, b) => byCodeUnit(a.id, b.id));
  const full = new Set(
    sorted.filter((e) => e.expectedAmbiguous === null).map((e) => e.id),
  );
  const covered = (fam: HypothesisFamily) =>
    sorted.some((e) => full.has(e.id) && e.recoveredFamilies.includes(fam));
  const present = new Set<HypothesisFamily>();
  for (const e of sorted) for (const f of e.recoveredFamilies) present.add(f);
  for (const fam of present) {
    if (covered(fam)) continue;
    const ex = sorted.find((e) => e.recoveredFamilies.includes(fam));
    if (ex) full.add(ex.id);
  }
  return full;
}

function buildPartition(run: OracleRun): string {
  const byId = (a: OracleEntry, b: OracleEntry) => byCodeUnit(a.id, b.id);
  const grid = run.gridEntries;
  const clean = grid.filter((e) => e.bucket === "clean");
  const structuralFailure = grid
    .filter((e) => e.bucket === "structural-failure")
    .sort(byId);
  const ambiguous = grid
    .filter((e) => e.bucket === "ambiguous-recovery")
    .sort(byId);

  const domOnly = ambiguous.filter(
    (e) => e.subBucket === "dom-convention-only",
  ).length;

  const mainEntries = grid.filter((e) => !e.minusOneOriginal);
  const minusOneEntries = grid.filter((e) => e.minusOneOriginal);

  const fullIds = fullExemplarIds(ambiguous);

  const partition = {
    _comment:
      "Round-trip oracle partition: evaluate∘infer over single-schedule, fully-resolved DSL templates on the widened grid. Headline counts scoped to grid cases. Irreducible-family entries are collapsed to id + expectedAmbiguous + subBucket; genuinely different-shape recoveries and one exemplar per hypothesis family stay full. Re-bless with `vitest -u` when a deliberate cross-package change shifts it.",
    grid: {
      sliceTags: V2_SLICE_TAGS,
      axisValues: V2_AXIS_VALUES,
      admitted: grid.length,
      prunedCount: run.prunedIds.length,
      prunedIds: [...run.prunedIds].sort(),
    },
    summary: {
      totalAdmitted: grid.length,
      clean: clean.length,
      structuralFailure: structuralFailure.length,
      ambiguousRecovery: ambiguous.length,
      ambiguousDomOnly: domOnly,
      ambiguousShapeDiff: ambiguous.length - domOnly,
      // MINUS_ONE-original cases are first-class grid points; the split keeps the
      // MINUS_ONE recovery visible as its own number.
      perDom: {
        main: bucketCounts(mainEntries),
        minusOne: bucketCounts(minusOneEntries),
      },
      // Collision-census ceiling: the max clean count any inferrer could reach on
      // this grid (one distinct template per observable class). Inferrer-independent.
      ceiling: run.ceiling,
      cleanVsCeiling: clean.length - run.ceiling,
      observableClasses: run.observableClasses,
      collisionClasses: run.collisionClasses,
      // The three irreducible families. fam1 is a stable params predicate; fam2/fam3
      // are recorded (they legitimately move on re-bless), never asserted.
      expectedAmbiguous: {
        fam1CliffGeDuration: grid.filter((e) => e.fam1).length,
        fam2ErasedPreGrantCliff: grid.filter((e) => e.fam2).length,
        fam3DomStampPair: grid.filter((e) => e.fam3).length,
      },
      cleanIds: clean.map((e) => e.id).sort(),
    },
    excludedSeeds: EXCLUDED_SEEDS,
    structuralFailure: structuralFailure.map((e) => serializeFull(e)),
    ambiguousRecovery: ambiguous.map((e) =>
      fullIds.has(e.id) ? serializeFull(e, true) : serializeCollapsed(e),
    ),
  };
  return JSON.stringify(partition, null, 2) + "\n";
}

// ---- tests ------------------------------------------------------------------

let run: OracleRun;

// One heavy sweep, memoized into the suite. The full grid runs ~2,010 inferences;
// the measured wall time is a few seconds (each case is a handful of candidate
// evaluations), so the 120s budget leaves ~30× headroom.
beforeAll(() => {
  run = runOracle();
}, 120_000);

describe("inferrer round-trip oracle — evaluate ∘ infer", () => {
  it("every admitted case projects equally and buckets into one of three", () => {
    expect(run.entries.length).toBeGreaterThan(2000);
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

  it("every admitted case recovers a storable template — structural-failure is zero", () => {
    // A future intentional change that breaks this must change the assert loudly,
    // never re-bless past it. Checked on every admitted case, not just the grid.
    const sf = run.entries.filter((e) => e.bucket === "structural-failure");
    expect(sf.map((e) => e.id)).toEqual([]);
  });

  it("clean floors hold: ≥737 main and ≥173 MINUS_ONE on the grid", () => {
    const grid = run.gridEntries;
    const mainClean = grid.filter(
      (e) => !e.minusOneOriginal && e.bucket === "clean",
    ).length;
    const minusOneClean = grid.filter(
      (e) => e.minusOneOriginal && e.bucket === "clean",
    ).length;
    expect(mainClean).toBeGreaterThanOrEqual(737);
    expect(minusOneClean).toBeGreaterThanOrEqual(173);
  });

  it("fam1 (cliff ≥ duration) tags 334 grid cases, none of them clean", () => {
    // The single-lump collapse: pure params predicate, verified to never tag a
    // clean case (a case whose observable IS a single lump can't recover the
    // original multi-occurrence template). This one is asserted stable; fam2/fam3
    // are recorded but move on re-bless.
    const fam1 = run.gridEntries.filter((e) => e.fam1);
    expect(fam1.length).toBe(334);
    expect(fam1.filter((e) => e.bucket === "clean")).toEqual([]);
  });

  it("the ceiling is a real upper bound on clean and is recorded", () => {
    const gridClean = run.gridEntries.filter(
      (e) => e.bucket === "clean",
    ).length;
    // At most one distinct template per observable class can be clean.
    expect(run.ceiling).toBeGreaterThanOrEqual(gridClean);
    expect(run.observableClasses).toBeGreaterThan(0);
    expect(run.collisionClasses).toBeGreaterThan(0);
  });

  it("every slice tag lands on ≥1 admitted grid entry", () => {
    const seen = new Set<string>();
    for (const e of run.gridEntries) for (const t of e.slices) seen.add(t);
    for (const tag of V2_SLICE_TAGS) expect(seen).toContain(tag);
  });

  it("every declared per-axis value is covered by an admitted grid entry", () => {
    const grid = run.gridEntries.filter(
      (
        e,
      ): e is OracleEntry & { params: Extract<CaseParams, { kind: "grid" }> } =>
        e.params.kind === "grid",
    );
    const seen = {
      offset: new Set(grid.map((e) => e.params.offset)),
      startDate: new Set(grid.map((e) => e.params.startDate)),
      duration: new Set(grid.map((e) => e.params.duration)),
      cadence: new Set(grid.map((e) => e.params.cadence)),
      cliff: new Set(grid.map((e) => String(e.params.cliff))),
      total: new Set(grid.map((e) => e.params.total)),
      dom: new Set(grid.map((e) => e.params.dom)),
    };
    for (const v of V2_AXIS_VALUES.offset) expect(seen.offset).toContain(v);
    for (const v of V2_AXIS_VALUES.startDate)
      expect(seen.startDate).toContain(v);
    for (const v of V2_AXIS_VALUES.duration) expect(seen.duration).toContain(v);
    for (const v of V2_AXIS_VALUES.cadence) expect(seen.cadence).toContain(v);
    for (const v of V2_AXIS_VALUES.cliff)
      expect(seen.cliff).toContain(String(v));
    for (const v of V2_AXIS_VALUES.total) expect(seen.total).toContain(v);
    for (const v of V2_AXIS_VALUES.dom) expect(seen.dom).toContain(v);

    // At least one cliff case whose tail genuinely ripples (round-down).
    expect(run.entries.some((e) => e.ripple)).toBe(true);
  });

  it("the prune rule drops a non-generable point (parse-stage failure)", () => {
    // OVER must be a multiple of EVERY; 12 / 5 is a parse error, so the point is
    // pruned rather than asserted. Demonstrates the try/catch is non-vacuous.
    expect(
      attemptTemplate(
        "100 VEST OVER 12 months EVERY 5 months",
        "2024-01-01",
        100,
        "VESTING_START_DAY",
      ),
    ).toBeNull();
  });

  it("the cliff-ripple seed is a template with a genuine round-down tail", () => {
    const e = run.byId.get("seed-0-cliff-ripple");
    expect(e).toBeDefined();
    expect(e?.originalStatus).toBe("template");
    expect(e?.ripple).toBe(true);
    // Bucket is recorded, not hard-asserted (the analytic core now recovers this
    // cliff cleanly, but a future change is a benign snapshot/behaviour shift).
    expect(e?.bucket).toBeDefined();
  });

  it("the isolated-singles seed evaluates to a template of distinct lumps", () => {
    const e = run.byId.get("seed-1-isolated-singles");
    expect(e).toBeDefined();
    expect(e?.originalStatus).toBe("template");
    expect(e?.originalAggregated).toEqual([
      { date: "2024-02-01", total: 137 },
      { date: "2024-03-01", total: 891 },
      { date: "2024-04-01", total: 42 },
    ]);
  });

  it("keeps at least one FULL exemplar per emitted hypothesis family", () => {
    const ambiguous = run.gridEntries.filter(
      (e) => e.bucket === "ambiguous-recovery",
    );
    const fullIds = fullExemplarIds(ambiguous);
    const fullEntries = ambiguous.filter((e) => fullIds.has(e.id));
    const present = new Set<HypothesisFamily>();
    for (const e of ambiguous)
      for (const f of e.recoveredFamilies) present.add(f);
    // Every family that appears among the ambiguous recoveries keeps a detailed
    // exemplar, so the cross-package tripwire covers every emission shape.
    for (const fam of present)
      expect(
        fullEntries.some((e) => e.recoveredFamilies.includes(fam)),
        `hypothesis family ${fam} must keep a full snapshot exemplar`,
      ).toBe(true);
    // The families that actually appear are a subset of the five known ones.
    for (const fam of present) expect(ALL_FAMILIES).toContain(fam);
  });

  it("the non-clean buckets match the committed partition snapshot", async () => {
    await expect(buildPartition(run)).toMatchFileSnapshot(PARTITION_PATH);
  });

  it("named clean cases are hard-asserted clean, independent of the snapshot", () => {
    expect(CLEAN_TRIPWIRE_CASES.length).toBeGreaterThan(0); // tripwire can't be a no-op
    // Includes the MINUS_ONE tripwire (a month-end-minus-one pattern no
    // VESTING_START_DAY seed reproduces), keeping the MINUS_ONE search wired.
    expect(CLEAN_TRIPWIRE_CASES.some((c) => isMinusOne(c.dom))).toBe(true);
    for (const c of CLEAN_TRIPWIRE_CASES) {
      const e = run.byId.get(c.id);
      expect(e, `${c.id} should be admitted`).toBeDefined();
      // Cannot be re-blessed by `vitest -u`: a slide clean → non-clean fails here
      // regardless of the snapshot.
      expect(e?.bucket, `${c.id} should round-trip clean`).toBe("clean");
    }
  });

  it("the projection comparator sums same-date amounts and orders by date", () => {
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

    expect(stripDom(domOnly)).toEqual(stripDom(base));
    expect(templatesEqualModuloDom(base, domOnly)).toBe(true);
    expect(templatesEqualModuloDom(base, shapeDiff)).toBe(false);
    expect(templatesEqual(base, domOnly)).toBe(false);
  });
});
