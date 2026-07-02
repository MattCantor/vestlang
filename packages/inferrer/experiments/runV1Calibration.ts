// Calibration: run the standalone sweep runner over the COMMITTED v1 oracle
// cases and demand it reproduce the committed partition exactly
// (77 clean / 58 structural-failure / 301 ambiguous-recovery over 436 admitted).
// Any drift means the runner's semantics diverged from the committed harness and
// nothing downstream of it can be trusted.
//
//   node packages/inferrer/experiments/runV1Calibration.ts [outDir]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLEAN_TRIPWIRE_CASES,
  gridCases,
  SEED_CASES,
} from "../tests/roundtripOracle.gen.ts";
import { defaultInferrer, runSweep } from "./sweepRunner.ts";

const EXPECTED = {
  admitted: 436,
  pruned: 0,
  clean: 77,
  structuralFailure: 58,
  ambiguousRecovery: 301,
};

const outDir = process.argv[2] ?? new URL("./out", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const t0 = Date.now();
const result = runSweep(
  [...gridCases(), ...SEED_CASES, ...CLEAN_TRIPWIRE_CASES],
  defaultInferrer,
);
const wallMs = Date.now() - t0;

const ok =
  result.counts.admitted === EXPECTED.admitted &&
  result.counts.pruned === EXPECTED.pruned &&
  result.counts.clean === EXPECTED.clean &&
  result.counts.structuralFailure === EXPECTED.structuralFailure &&
  result.counts.ambiguousRecovery === EXPECTED.ambiguousRecovery;

const report = {
  calibrationMatched: ok,
  expected: EXPECTED,
  observed: result.counts,
  wallMs,
  projectionAnomalies: result.projectionAnomalies,
  inferErrors: result.inferErrors,
  pruned: result.pruned,
};

writeFileSync(
  join(outDir, "v1-calibration.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report.observed), `wall ${wallMs}ms`);
if (result.projectionAnomalies.length > 0)
  console.error(
    "HARD ANOMALY — projection mismatches on admitted cases:",
    result.projectionAnomalies,
  );
if (!ok) {
  console.error("CALIBRATION FAILED — runner diverges from committed harness");
  process.exit(1);
}
console.log("calibration matched: 77 clean / 58 SF / 301 ambiguous");
