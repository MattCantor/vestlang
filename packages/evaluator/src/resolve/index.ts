// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`): `template`, `events`, or `unresolved`. This is the live
// evaluate path — `evaluateStatement`/`evaluateProgram` run through here.

import type { EvaluationContextInput, Finding, Program } from "@vestlang/types";
import {
  assertValidVestingScheduleTemplate,
  fracCmp,
  fracSum,
  ONE,
} from "@vestlang/core";
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
    findings: overAllocationFindings(verdict, resolutions, totalShares),
  };
};

// Catch a program that vests more than the whole grant. We check here, before the
// result splits into a template or a bag of events, because that split is exactly
// where the two ways to over-allocate diverge — a single `3/2` statement becomes a
// template, while `3/4 PLUS 3/4` becomes events — yet both are still visible as the
// same flat list of resolved statements, each carrying its share-of-grant fraction.
// Summing those fractions catches both at once. Mixed quantity/portion programs come
// out in the wash too, since the share counts have already been lowered to fractions.
const overAllocationFindings = (
  verdict: ResolveVerdict,
  resolutions: StmtResolution[],
  totalShares: number,
): Finding[] => {
  // A grant of zero shares can't over- (or under-) allocate, and we must bail before
  // summing: a quantity over zero shares lowers to a 1/0 fraction, which the
  // comparison would misread as "greater than the whole grant".
  if (totalShares === 0) return [];
  // An impossible program never resolves to anything, so flagging an overage on top
  // of that contradiction is just noise.
  if (verdict.kind === "impossible") return [];

  const sum = fracSum(resolutions.map((r) => r.percentage));
  if (fracCmp(sum, ONE) > 0) {
    return [
      { kind: "over-allocation", severity: "error", sum, path: ["Program"] },
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
