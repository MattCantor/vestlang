// The widened (v2) round-trip sweep: run the v2 grid through the standalone
// runner and write analysis + a full non-clean per-case dump as JSON.
//
//   node packages/inferrer/experiments/runV2Sweep.ts [outDir]
//
// Writes:
//   <outDir>/widened-results.json   counts, marginals, clusters, prunes, growth
//   <outDir>/widened-failures.json  every NON-CLEAN admitted case, full detail
//
// MINUS_ONE-original cases are analyzed SEPARATELY throughout: the inferrer's
// policy search deliberately excludes VESTING_START_DAY_MINUS_ONE (#503), so
// those originals are an expected blind spot and would drown the other signal.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Cases, type V2Case, type V2Params } from "./oracleV2.gen.ts";
import {
  defaultInferrer,
  runSweep,
  type SweepEntry,
  type SweepResult,
} from "./sweepRunner.ts";

const outDir = process.argv[2] ?? new URL("./out", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

// ---- axis derivations --------------------------------------------------------

type CliffClass =
  | "none"
  | "on-boundary"
  | "off-boundary"
  | "eq-duration"
  | "gt-duration";

function cliffClass(p: V2Params): CliffClass {
  if (p.cliff === null) return "none";
  if (p.cliff > p.duration) return "gt-duration";
  if (p.cliff === p.duration) return "eq-duration";
  return p.cliff % p.cadence === 0 ? "on-boundary" : "off-boundary";
}

function totalClass(total: number): string {
  if (total === 5 || total === 10) return "sub-occurrence(5,10)";
  if (total === 97) return "prime(97)";
  if (total === 96) return "divisor-rich(96)";
  return `round(${total})`;
}

// Recovered-shape pattern, read off the recovered DSL's statement list:
//   grid   = has OVER (a periodic segment)     gridC = grid with a CLIFF
//   lump   = bare "N VEST FROM DATE d" (no OVER)
// compressed as e.g. "grid+lump", "lumpx4".
function shapePattern(recoveredDsl: string): string {
  if (recoveredDsl === "") return "INFER_ERROR";
  const stmts = recoveredDsl.split(/\s+(?:PLUS|THEN)\s+/);
  const kinds = stmts.map((s) =>
    / OVER /.test(s) ? (/ CLIFF /.test(s) ? "gridC" : "grid") : "lump",
  );
  const parts: string[] = [];
  let i = 0;
  while (i < kinds.length) {
    let j = i;
    while (j + 1 < kinds.length && kinds[j + 1] === kinds[i]) j++;
    const run = j - i + 1;
    parts.push(run === 1 ? kinds[i] : `${kinds[i]}x${run}`);
    i = j + 1;
  }
  return parts.join("+");
}

// Coarse family over shape patterns, for report-sized clusters: which segments
// the recovered cover mixes, not how many.
function shapeFamily(pattern: string): string {
  if (pattern === "INFER_ERROR") return "infer-error";
  const hasGrid = /grid/.test(pattern);
  const hasLump = /lump/.test(pattern);
  if (hasGrid && !hasLump) return "multi-grid";
  if (!hasGrid && hasLump) return "all-lumps";
  if (pattern === "grid+lump") return "grid+trailing-lump";
  if (pattern === "lump+grid") return "lead-lump+grid";
  return "mixed-grid-lump";
}

// ---- run ----------------------------------------------------------------------

const cases = v2Cases();
const byId = new Map(cases.map((c) => [c.id, c]));
const t0 = Date.now();
const result: SweepResult = runSweep(cases, defaultInferrer);
const wallMs = Date.now() - t0;

const caseOf = (id: string): V2Case => byId.get(id)!;
const paramsOf = (e: SweepEntry): V2Params => caseOf(e.id).params;
const isMinusOne = (e: SweepEntry): boolean =>
  paramsOf(e).dom === "VESTING_START_DAY_MINUS_ONE";

const mainEntries = result.entries.filter((e) => !isMinusOne(e));
const minusOneEntries = result.entries.filter(isMinusOne);

function bucketCounts(entries: SweepEntry[]) {
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

// ---- marginals (SF rate per axis value, MINUS_ONE originals excluded) --------

function marginal(
  entries: SweepEntry[],
  key: (p: V2Params) => string,
): Record<string, { n: number; sf: number; sfRate: string }> {
  const acc = new Map<string, { n: number; sf: number }>();
  for (const e of entries) {
    const k = key(paramsOf(e));
    const cur = acc.get(k) ?? { n: 0, sf: 0 };
    cur.n++;
    if (e.bucket === "structural-failure") cur.sf++;
    acc.set(k, cur);
  }
  const out: Record<string, { n: number; sf: number; sfRate: string }> = {};
  for (const [k, v] of [...acc.entries()].sort())
    out[k] = { ...v, sfRate: (v.sf / v.n).toFixed(3) };
  return out;
}

const byAxis = {
  cliffClass: marginal(mainEntries, (p) => cliffClass(p)),
  cadence: marginal(mainEntries, (p) => `cad-${String(p.cadence).padStart(2, "0")}`),
  dom: marginal(mainEntries, (p) => p.dom),
  startDay: marginal(mainEntries, (p) => p.startDate),
  offset: marginal(mainEntries, (p) => p.offset),
  totalClass: marginal(mainEntries, (p) => totalClass(p.total)),
  durationCadence: marginal(mainEntries, (p) => `${p.duration}x${p.cadence}`),
  // Two-way: is off- vs on-boundary the driver, or the total's ripple? Read
  // boundary alignment at fixed total class.
  cliffClassXTotal: marginal(
    mainEntries,
    (p) => `${cliffClass(p)} @ ${totalClass(p.total)}`,
  ),
};

// ---- v1-comparable vs new territory -------------------------------------------

const comparable = mainEntries.filter((e) => caseOf(e.id).v1Comparable);
const newTerritory = mainEntries.filter((e) => !caseOf(e.id).v1Comparable);

// ---- prune reasons -------------------------------------------------------------

const pruneReasons: Record<string, number> = {};
const pruneByCliffClass: Record<string, Record<string, number>> = {};
for (const p of result.pruned) {
  pruneReasons[p.reason] = (pruneReasons[p.reason] ?? 0) + 1;
  const cc = cliffClass(caseOf(p.id).params);
  pruneByCliffClass[cc] ??= {};
  pruneByCliffClass[cc][p.reason] = (pruneByCliffClass[cc][p.reason] ?? 0) + 1;
}

// ---- clusters -------------------------------------------------------------------

interface Cluster {
  key: string;
  count: number;
  exemplarIds: string[];
  buckets: Record<string, number>;
}

function clusterBy(
  entries: SweepEntry[],
  key: (e: SweepEntry) => string,
): Cluster[] {
  const acc = new Map<string, { count: number; ids: string[]; buckets: Record<string, number> }>();
  for (const e of entries) {
    const k = key(e);
    const cur = acc.get(k) ?? { count: 0, ids: [], buckets: {} };
    cur.count++;
    if (cur.ids.length < 5) cur.ids.push(e.id);
    cur.buckets[e.bucket] = (cur.buckets[e.bucket] ?? 0) + 1;
    acc.set(k, cur);
  }
  return [...acc.entries()]
    .map(([key, v]) => ({ key, count: v.count, exemplarIds: v.ids, buckets: v.buckets }))
    .sort((a, b) => b.count - a.count);
}

const sfKey = (e: SweepEntry): string => {
  const p = paramsOf(e);
  return [
    `rec=${e.recoveredStatus}`,
    `shape=${shapePattern(e.recoveredDsl)}`,
    `cliff=${cliffClass(p)}`,
    `off=${p.offset}`,
    `tot=${totalClass(p.total)}`,
  ].join("|");
};

const sfClusters = clusterBy(
  mainEntries.filter((e) => e.bucket === "structural-failure"),
  sfKey,
);
// Report-sized: recovered-shape FAMILY x cliff class (offset/total folded in).
const sfCoarseClusters = clusterBy(
  mainEntries.filter((e) => e.bucket === "structural-failure"),
  (e) =>
    `family=${shapeFamily(shapePattern(e.recoveredDsl))}|cliff=${cliffClass(paramsOf(e))}`,
);
const shapeDiffClusters = clusterBy(
  mainEntries.filter((e) => e.subBucket === "shape-diff"),
  (e) => {
    const p = paramsOf(e);
    return [
      `shape=${shapePattern(e.recoveredDsl)}`,
      `cliff=${cliffClass(p)}`,
      `off=${p.offset}`,
    ].join("|");
  },
);
const minusOneClusters = clusterBy(minusOneEntries, (e) => {
  const p = paramsOf(e);
  return [
    `bucket=${e.bucket}${e.subBucket ? `/${e.subBucket}` : ""}`,
    `rec=${e.recoveredStatus}`,
    `start=${p.startDate}`,
  ].join("|");
});

// ---- outputs --------------------------------------------------------------------

const nonClean = result.entries.filter((e) => e.bucket !== "clean");
const failureDump = nonClean.map((e) => ({
  id: e.id,
  params: paramsOf(e),
  slices: caseOf(e.id).slices,
  v1Comparable: caseOf(e.id).v1Comparable,
  minusOneOriginal: isMinusOne(e),
  bucket: e.bucket,
  subBucket: e.subBucket,
  recoveredStatus: e.recoveredStatus,
  ...(e.inferError !== undefined ? { inferError: e.inferError } : {}),
  shapePattern: shapePattern(e.recoveredDsl),
  shapeFamily: shapeFamily(shapePattern(e.recoveredDsl)),
  cliffClass: cliffClass(paramsOf(e)),
  grantDate: e.grantDate,
  originalDsl: e.originalDsl,
  recoveredDsl: e.recoveredDsl,
  originalDom: e.originalDom,
  inferredDom: e.inferredDom,
  originalTemplate: e.originalTemplate,
  recoveredTemplate: e.recoveredTemplate,
  projMatch: e.projMatch,
  projectionDivergence: e.projectionDivergence,
}));

const analysis = {
  grid: {
    totalCases: cases.length,
    admitted: result.counts.admitted,
    pruned: result.counts.pruned,
    wallMs,
  },
  projectionAnomalies: result.projectionAnomalies,
  inferErrors: result.inferErrors,
  main: bucketCounts(mainEntries),
  minusOneOriginals: bucketCounts(minusOneEntries),
  v1Comparable: bucketCounts(comparable),
  newTerritory: bucketCounts(newTerritory),
  byAxis,
  pruneReasons,
  pruneByCliffClass,
  sfCoarseClusters,
  sfClusters,
  shapeDiffClusters: shapeDiffClusters.slice(0, 20),
  minusOneClusters,
};

writeFileSync(
  join(outDir, "widened-results.json"),
  JSON.stringify(analysis, null, 2) + "\n",
);
writeFileSync(
  join(outDir, "widened-failures.json"),
  JSON.stringify(failureDump, null, 2) + "\n",
);

console.log(JSON.stringify(analysis.grid));
console.log("main       ", JSON.stringify(analysis.main));
console.log("minusOne   ", JSON.stringify(analysis.minusOneOriginals));
console.log("v1Compar   ", JSON.stringify(analysis.v1Comparable));
console.log("newTerr    ", JSON.stringify(analysis.newTerritory));
console.log("prunes     ", JSON.stringify(pruneReasons));
if (result.inferErrors.length > 0)
  console.error(
    `INFERRER THREW on ${result.inferErrors.length} case(s):`,
    result.inferErrors.map((e) => e.id),
  );
if (result.projectionAnomalies.length > 0)
  console.error(
    "HARD ANOMALY — recovered eval succeeded but projection diverged:",
    result.projectionAnomalies,
  );
