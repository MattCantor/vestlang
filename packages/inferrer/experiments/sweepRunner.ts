// Standalone round-trip sweep runner (no vitest) — the committed oracle harness
// (tests/roundtripOracle.test.ts) re-expressed as a library so widened grids can
// run outside the snapshot machinery.
//
// Semantics are a faithful copy of the committed test:
//   evaluate original DSL  →  infer({tranches, grantDate})  →  re-evaluate the
//   inferred DSL through the independent public pipeline (parse →
//   normalizeProgram → evaluateProgram) under the inferred day-of-month  →
//   bucket clean / structural-failure / ambiguous-recovery.
//
// Two deliberate extensions over the committed harness:
//   - the inferrer is a PLUGGABLE argument (InferrerFn), so a spike can run the
//     identical grid against a different implementation by swapping one value;
//   - ambiguous-recovery is sub-bucketed into dom-convention-only (templates
//     deep-equal once `vesting_day_of_month` is stripped from every schedule
//     segment on both sides — the #506 explicitness artifact) vs shape-diff.
//
// Run with plain `node` (>=22.18 native type stripping) or tsx.

import { isDeepStrictEqual } from "node:util";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  EvaluatedSchedule,
  Installment,
  OCTDate,
  ResolutionContextInput,
  ResolvedInstallment,
  VestingDayOfMonth,
  OCFVestingTermsV2,
} from "@vestlang/types";
// The current committed inferrer, via its built dist (experiments never import
// package src — dist is what the workspace build produced and what a consumer
// gets). A spike swaps `defaultInferrer` out, it does not edit this file.
import { inferSchedule } from "../dist/index.js";

export type Projection = { date: OCTDate; total: number }[];
export type Bucket = "clean" | "structural-failure" | "ambiguous-recovery";
export type AmbiguousSubBucket = "dom-convention-only" | "shape-diff";

export interface Tranche {
  date: OCTDate;
  amount: number;
}

/** The pluggable inversion under test. */
export type InferrerFn = (
  tranches: Tranche[],
  grantDate: OCTDate,
) => { dsl: string; vestingDayOfMonth: VestingDayOfMonth };

export const defaultInferrer: InferrerFn = (tranches, grantDate) => {
  const r = inferSchedule({ tranches, grantDate });
  return { dsl: r.dsl, vestingDayOfMonth: r.diagnostics.vestingDayOfMonth };
};

/** Minimal case shape — both the committed v1 OracleCase and the v2 generator's
 *  cases satisfy it structurally. `params` rides along untyped for analysis. */
export interface SweepCase {
  id: string;
  dsl: string;
  grantDate: OCTDate;
  total: number;
  dom: VestingDayOfMonth;
  params?: unknown;
}

export type PruneReason =
  | "parse-error"
  | "eval-error"
  | `status-${string}`
  | "unresolved-installments";

export interface SweepEntry {
  id: string;
  params: unknown;
  grantDate: OCTDate;
  bucket: Bucket;
  /** Only for ambiguous-recovery. */
  subBucket: AmbiguousSubBucket | null;
  recoveredStatus: string;
  /** Present only when the inferrer itself threw (recoveredStatus INFER_ERROR). */
  inferError?: string;
  originalDsl: string;
  recoveredDsl: string;
  originalDom: VestingDayOfMonth;
  inferredDom: VestingDayOfMonth;
  originalTemplate: OCFVestingTermsV2;
  recoveredTemplate: OCFVestingTermsV2 | null;
  projMatch: boolean;
  projectionDivergence: { original: Projection; recovered: Projection } | null;
  originalAggregated: Projection;
}

export interface SweepResult {
  entries: SweepEntry[];
  pruned: { id: string; reason: PruneReason; params: unknown }[];
  counts: {
    admitted: number;
    pruned: number;
    clean: number;
    structuralFailure: number;
    ambiguousRecovery: number;
    ambiguousDomOnly: number;
    ambiguousShapeDiff: number;
  };
  /** Admitted cases where the recovered evaluation SUCCEEDED yet projected a
   *  different stream — a hard anomaly in this harness (the committed AC1
   *  asserts none exist on v1). Never silently swallowed. Inferrer crashes and
   *  unparseable output are NOT in here — they carry their own loud sentinel
   *  statuses (INFER_ERROR / ERROR) and land in `inferErrors` / the buckets. */
  projectionAnomalies: string[];
  /** Cases where the inferrer itself threw (bucketed structural-failure). */
  inferErrors: { id: string; error: string }[];
}

// ---- pipeline (identical idioms to the committed test) ----------------------

function evalUnder(
  dsl: string,
  grantDate: OCTDate,
  total: number,
  dom: VestingDayOfMonth,
): EvaluatedSchedule {
  const program = normalizeProgram(parse(dsl));
  const ctx: ResolutionContextInput = {
    grantDate,
    events: {},
    grantQuantity: total,
    vesting_day_of_month: dom,
  };
  return evaluateProgram(program, ctx);
}

function resolvedStream(sched: EvaluatedSchedule): Tranche[] {
  const items: Installment[] = sched.resolution.installments;
  return items
    .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
    .map((i) => ({ date: i.date, amount: i.amount }));
}

const byCodeUnit = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export function aggregateProjection(stream: Tranche[]): Projection {
  const byDate = new Map<OCTDate, number>();
  for (const { date, amount } of stream)
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  return [...byDate.entries()]
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([date, total]) => ({ date, total }));
}

function templatesEqual(a: OCFVestingTermsV2, b: OCFVestingTermsV2): boolean {
  return isDeepStrictEqual(a, b);
}

/** Deep-equal after deleting `vesting_day_of_month` from every schedule segment
 *  on both sides — isolates the dom-explicitness artifact (#506: the original
 *  eval stamps the policy, the recovered eval's searched-default omits it). */
function templatesEqualModuloDom(
  a: OCFVestingTermsV2,
  b: OCFVestingTermsV2,
): boolean {
  return isDeepStrictEqual(stripDom(a), stripDom(b));
}

function stripDom(t: OCFVestingTermsV2): OCFVestingTermsV2 {
  const clone = structuredClone(t);
  for (const st of clone.statements) {
    if ("schedule" in st && st.schedule) delete st.schedule.vesting_day_of_month;
  }
  return clone;
}

// ---- admission (the committed prune rule, with the reason split out) ---------

type Admitted = {
  template: OCFVestingTermsV2;
  stream: Tranche[];
};

function attemptTemplate(
  c: SweepCase,
): { ok: true; value: Admitted } | { ok: false; reason: PruneReason } {
  // The committed harness wraps the whole parse → normalize → evaluate in one
  // try/catch; splitting parse from eval here only refines the REPORTED reason,
  // never the admit/prune decision.
  let program;
  try {
    program = normalizeProgram(parse(c.dsl));
  } catch {
    return { ok: false, reason: "parse-error" };
  }
  let sched: EvaluatedSchedule;
  try {
    const ctx: ResolutionContextInput = {
      grantDate: c.grantDate,
      events: {},
      grantQuantity: c.total,
      vesting_day_of_month: c.dom,
    };
    sched = evaluateProgram(program, ctx);
  } catch {
    return { ok: false, reason: "eval-error" };
  }
  const r = sched.resolution;
  const items: Installment[] = r.installments;
  if (r.status !== "template")
    return { ok: false, reason: `status-${r.status}` };
  if (!items.every((i) => i.state === "RESOLVED"))
    return { ok: false, reason: "unresolved-installments" };
  return { ok: true, value: { template: r.template, stream: resolvedStream(sched) } };
}

// ---- the per-case round trip -------------------------------------------------

export function runCase(
  c: SweepCase,
  inferrer: InferrerFn,
): { kind: "entry"; entry: SweepEntry } | { kind: "pruned"; reason: PruneReason } {
  const admitted = attemptTemplate(c);
  if (!admitted.ok) return { kind: "pruned", reason: admitted.reason };

  const originalAggregated = aggregateProjection(admitted.value.stream);

  let inferredDsl: string;
  let inferredDom: VestingDayOfMonth;
  let inferError: string | undefined;
  try {
    const inf = inferrer(admitted.value.stream, c.grantDate);
    inferredDsl = inf.dsl;
    inferredDom = inf.vestingDayOfMonth;
  } catch (err) {
    // The committed harness has no catch here because the current inferrer never
    // throws over v1. On a widened grid an inferrer crash IS an inversion
    // failure, so it lands in structural-failure with a loud sentinel status.
    inferError = err instanceof Error ? err.message : String(err);
    inferredDsl = "";
    inferredDom = c.dom;
  }

  let recoveredStatus: string;
  let recoveredTemplate: OCFVestingTermsV2 | null = null;
  let recoveredAggregated: Projection;
  if (inferError !== undefined) {
    recoveredStatus = "INFER_ERROR";
    recoveredAggregated = [];
  } else {
    try {
      const recSched = evalUnder(inferredDsl, c.grantDate, c.total, inferredDom);
      const rr = recSched.resolution;
      recoveredStatus = rr.status;
      recoveredTemplate = rr.status === "template" ? rr.template : null;
      recoveredAggregated = aggregateProjection(resolvedStream(recSched));
    } catch {
      // Same defensive arm as the committed test: unparseable inferred output
      // reads as a structural failure, never crashes the sweep.
      recoveredStatus = "ERROR";
      recoveredAggregated = [];
    }
  }

  const projMatch = isDeepStrictEqual(originalAggregated, recoveredAggregated);

  // Bucket rule: verbatim from the committed test (Decision 2).
  let bucket: Bucket;
  if (
    recoveredStatus === "template" &&
    recoveredTemplate !== null &&
    templatesEqual(recoveredTemplate, admitted.value.template) &&
    projMatch
  )
    bucket = "clean";
  else if (recoveredStatus !== "template") bucket = "structural-failure";
  else bucket = "ambiguous-recovery";

  const subBucket: AmbiguousSubBucket | null =
    bucket === "ambiguous-recovery" && recoveredTemplate !== null
      ? templatesEqualModuloDom(recoveredTemplate, admitted.value.template) &&
        projMatch
        ? "dom-convention-only"
        : "shape-diff"
      : null;

  return {
    kind: "entry",
    entry: {
      id: c.id,
      params: c.params ?? null,
      grantDate: c.grantDate,
      bucket,
      subBucket,
      recoveredStatus,
      ...(inferError !== undefined ? { inferError } : {}),
      originalDsl: c.dsl,
      recoveredDsl: inferredDsl,
      originalDom: c.dom,
      inferredDom,
      originalTemplate: admitted.value.template,
      recoveredTemplate,
      projMatch,
      projectionDivergence: projMatch
        ? null
        : { original: originalAggregated, recovered: recoveredAggregated },
      originalAggregated,
    },
  };
}

export function runSweep(
  cases: SweepCase[],
  inferrer: InferrerFn = defaultInferrer,
): SweepResult {
  const entries: SweepEntry[] = [];
  const pruned: SweepResult["pruned"] = [];
  for (const c of cases) {
    const r = runCase(c, inferrer);
    if (r.kind === "entry") entries.push(r.entry);
    else pruned.push({ id: c.id, reason: r.reason, params: c.params ?? null });
  }
  const clean = entries.filter((e) => e.bucket === "clean").length;
  const sf = entries.filter((e) => e.bucket === "structural-failure").length;
  const amb = entries.filter((e) => e.bucket === "ambiguous-recovery");
  const domOnly = amb.filter((e) => e.subBucket === "dom-convention-only").length;
  return {
    entries,
    pruned,
    counts: {
      admitted: entries.length,
      pruned: pruned.length,
      clean,
      structuralFailure: sf,
      ambiguousRecovery: amb.length,
      ambiguousDomOnly: domOnly,
      ambiguousShapeDiff: amb.length - domOnly,
    },
    projectionAnomalies: entries
      .filter(
        (e) =>
          !e.projMatch &&
          e.recoveredStatus !== "INFER_ERROR" &&
          e.recoveredStatus !== "ERROR",
      )
      .map((e) => e.id),
    inferErrors: entries
      .filter((e) => e.inferError !== undefined)
      .map((e) => ({ id: e.id, error: e.inferError! })),
  };
}
