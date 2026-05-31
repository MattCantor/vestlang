// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`). Phase 4a implements the `template` arm; Phase 4b
// completes `events` and `unresolved`. Not wired into the live evaluate path.

import type { EvaluationContextInput, Program } from "@vestlang/types";
import { assertValidVestingScheduleTemplate } from "@vestlang/core";
import { createEvaluationContext } from "../utils.js";
import { resolveStatements, buildTemplate } from "./lower.js";
import { classify } from "./classify.js";
import type { ResolveResult } from "./types.js";

export const resolveToCore = (
  program: Program,
  ctxInput: EvaluationContextInput,
): ResolveResult => {
  const ctx = createEvaluationContext(ctxInput);
  const totalShares = ctx.grantQuantity;
  const resolutions = resolveStatements(program, ctx, totalShares);
  const build = buildTemplate(resolutions, ctx, totalShares);

  if (build.ok) {
    assertValidVestingScheduleTemplate(build.template);
    return {
      kind: "template",
      template: build.template,
      runtime: build.runtime,
      totalShares: build.totalShares,
      sourceMap: build.sourceMap,
      blockers: build.blockers,
    };
  }

  // Resolves but doesn't fit one template (events) or can't materialize (unresolved).
  return classify(build, program);
};

export { resolveStatements, buildTemplate, amountToFraction } from "./lower.js";
export { lowerCliff } from "./cliff.js";
export { classify } from "./classify.js";
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
export type { SymbolicInstallment } from "@vestlang/types";
