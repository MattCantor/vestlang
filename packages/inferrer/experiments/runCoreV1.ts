// Analytic-CORE sweep over the committed v1 oracle cases (same grid the
// calibration and spike runs use), with the stage-2b core swapped in for the
// committed inferrer. Clone of runSpikeV1.ts pointing at the production core.
//
//   node packages/inferrer/experiments/runCoreV1.ts [outDir]
//
// The core is imported from the built dist, so build first:
//   pnpm --dir packages/inferrer build
//
// Writes <outDir>/core-analytic-v1.json: counts + every NON-CLEAN case in full.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLEAN_TRIPWIRE_CASES,
  gridCases,
  SEED_CASES,
} from "../tests/roundtripOracle.gen.ts";
import { runSweep } from "./sweepRunner.ts";
import { analyticInferrer, analyticStats } from "../dist/index.js";

const outDir = process.argv[2] ?? new URL("./out", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const t0 = Date.now();
const result = runSweep(
  [...gridCases(), ...SEED_CASES, ...CLEAN_TRIPWIRE_CASES],
  analyticInferrer,
);
const wallMs = Date.now() - t0;

const nonClean = result.entries
  .filter((e) => e.bucket !== "clean")
  .map((e) => ({
    id: e.id,
    params: e.params,
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
  counts: result.counts,
  wallMs,
  analyticStats,
  projectionAnomalies: result.projectionAnomalies,
  inferErrors: result.inferErrors,
  pruned: result.pruned,
  nonClean,
};

writeFileSync(
  join(outDir, "core-analytic-v1.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(result.counts),
  `wall ${wallMs}ms`,
  JSON.stringify(analyticStats),
);
if (result.inferErrors.length > 0)
  console.error("CORE THREW on:", result.inferErrors.map((e) => e.id));
if (result.projectionAnomalies.length > 0)
  console.error("HARD ANOMALY:", result.projectionAnomalies);
