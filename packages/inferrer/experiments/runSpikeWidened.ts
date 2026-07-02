// Analytic-spike sweep over the widened (v2) grid, MINUS_ONE-original subset
// reported separately exactly like the baseline widened run.
//
//   node packages/inferrer/experiments/runSpikeWidened.ts [outDir]
//
// Writes <outDir>/spike-analytic-widened.json: counts (main + MINUS_ONE),
// structural-failure clusters, and every NON-CLEAN case in full.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v2Cases, type V2Case, type V2Params } from "./oracleV2.gen.ts";
import { runSweep, type SweepEntry } from "./sweepRunner.ts";
import { analyticInferrer, spikeStats } from "./analyticSpike.ts";

const outDir = process.argv[2] ?? new URL("./out", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const cases = v2Cases();
const byId = new Map(cases.map((c) => [c.id, c]));
const t0 = Date.now();
const result = runSweep(cases, analyticInferrer);
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

const sfEntries = result.entries.filter((e) => e.bucket === "structural-failure");
const sfClusters = new Map<string, { count: number; ids: string[] }>();
for (const e of sfEntries) {
  const p = paramsOf(e);
  const key = [
    `cliff=${cliffClass(p)}`,
    `off=${p.offset}`,
    `dom=${p.dom}`,
    `tot=${p.total}`,
  ].join("|");
  const cur = sfClusters.get(key) ?? { count: 0, ids: [] };
  cur.count++;
  if (cur.ids.length < 5) cur.ids.push(e.id);
  sfClusters.set(key, cur);
}

const nonClean = result.entries
  .filter((e) => e.bucket !== "clean")
  .map((e) => ({
    id: e.id,
    params: paramsOf(e),
    minusOneOriginal: isMinusOne(e),
    cliffClass: cliffClass(paramsOf(e)),
    bucket: e.bucket,
    subBucket: e.subBucket,
    recoveredStatus: e.recoveredStatus,
    ...(e.inferError !== undefined ? { inferError: e.inferError } : {}),
    grantDate: e.grantDate,
    originalDsl: e.originalDsl,
    recoveredDsl: e.recoveredDsl,
    originalDom: e.originalDom,
    inferredDom: e.inferredDom,
    projMatch: e.projMatch,
    projectionDivergence: e.projectionDivergence,
  }));

const report = {
  grid: {
    totalCases: cases.length,
    admitted: result.counts.admitted,
    pruned: result.counts.pruned,
    wallMs,
  },
  spikeStats,
  main: bucketCounts(mainEntries),
  minusOneOriginals: bucketCounts(minusOneEntries),
  projectionAnomalies: result.projectionAnomalies,
  inferErrors: result.inferErrors,
  sfClusters: [...sfClusters.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count),
  pruneReasons: result.pruned.reduce<Record<string, number>>((acc, p) => {
    acc[p.reason] = (acc[p.reason] ?? 0) + 1;
    return acc;
  }, {}),
  nonClean,
};

writeFileSync(
  join(outDir, "spike-analytic-widened.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report.grid), JSON.stringify(spikeStats));
console.log("main    ", JSON.stringify(report.main));
console.log("minusOne", JSON.stringify(report.minusOneOriginals));
if (result.inferErrors.length > 0)
  console.error("SPIKE THREW on:", result.inferErrors.map((e) => e.id));
if (result.projectionAnomalies.length > 0)
  console.error("HARD ANOMALY:", result.projectionAnomalies);
if (sfEntries.length > 0)
  console.log(
    "SF clusters:",
    JSON.stringify(report.sfClusters.slice(0, 15), null, 1),
  );
