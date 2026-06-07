// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`): `template`, `events`, or `unresolved`. This is the live
// evaluate path — `evaluateStatement`/`evaluateProgram` run through here.

import type { EvaluationContextInput, Finding, Program } from "@vestlang/types";
import { assertValidVestingScheduleTemplate } from "@vestlang/core";
import { fracCmp, fracSum, ONE } from "@vestlang/utils";
import { createEvaluationContext } from "../utils.js";
import { resolveStatements, buildTemplate } from "./lower.js";
import type { StmtResolution } from "./lower.js";
import { classify } from "./classify.js";
import type { ResolveResult, ResolveVerdict } from "./types.js";

export const resolveToCore = (
  program: Program,
  ctxInput: EvaluationContextInput,
): ResolveResult => {
  const ctx = createEvaluationContext(ctxInput);
  const totalShares = ctx.grantQuantity;
  const resolutions = resolveStatements(program, ctx, totalShares);
  const build = buildTemplate(resolutions, ctx, totalShares);

  let verdict: ResolveVerdict;
  if (build.ok) {
    assertValidVestingScheduleTemplate(build.template);
    verdict = {
      kind: "template",
      template: build.template,
      runtime: build.runtime,
      totalShares: build.totalShares,
      sourceMap: build.sourceMap,
      blockers: build.blockers,
    };
  } else {
    // Resolves but doesn't fit one template (events) or can't materialize (unresolved).
    verdict = classify(build, program);
  }

  return {
    ...verdict,
    findings: allocationFindings(verdict, resolutions, totalShares),
  };
};

// Check how much of the grant the schedule allocates. We look here, before the
// result splits into a template or a bag of events, because that split is exactly
// where the cases diverge — a single `3/2` statement becomes a template, while
// `3/4 PLUS 3/4` becomes events — yet both are still visible as the same flat list of
// resolved statements, each carrying its share-of-grant fraction. Summing those
// fractions and comparing to the whole grant catches everything at once. Mixed
// quantity/portion programs come out in the wash too, since the share counts have
// already been lowered to fractions.
//
// Over the grant is an error — a grant can never vest more than 100% of itself. Under
// the grant is only a warning: leaving some of the grant unvested is a legal thing to
// write, just usually worth a heads-up.
const allocationFindings = (
  verdict: ResolveVerdict,
  resolutions: StmtResolution[],
  totalShares: number,
): Finding[] => {
  // A grant of zero shares can't over- or under-allocate — there's nothing to
  // allocate against — so any sum is moot and we raise no finding.
  if (totalShares === 0) return [];
  // An impossible program never resolves to anything, so flagging its allocation on
  // top of that contradiction is just noise.
  if (verdict.kind === "impossible") return [];

  const sum = fracSum(resolutions.map((r) => r.percentage));
  const cmp = fracCmp(sum, ONE);
  if (cmp > 0) {
    return [
      { kind: "over-allocation", severity: "error", sum, path: ["Program"] },
    ];
  }
  if (cmp < 0) {
    return [
      { kind: "under-allocation", severity: "warning", sum, path: ["Program"] },
    ];
  }
  return [];
};

export { rehydrate, reparseDefinition } from "./rehydrate.js";
export type { RehydrateResult } from "./rehydrate.js";
export {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
} from "./sidecar.js";
export type { Sidecar, PersistedArtifact } from "./sidecar.js";
export type { ResolveResult, NonTemplateReason } from "./types.js";
