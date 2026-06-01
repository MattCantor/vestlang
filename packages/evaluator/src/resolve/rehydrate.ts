// Rehydration: turn a stored canonical artifact + the world's named-event
// firings into synthetic-event witnesses.
//
// Lowering a combinator-over-anchors start into a `template` externalizes the
// gate as a grant-scoped synthetic event (`evt_<n>`) with NO firing and a
// source-map definition (its DSL). Rehydration is the inverse half:
// when the world's named events fire (the IPO happens — attested by the caller in
// `ctx.events`, the same channel `evaluateVestingBase` already reads), each
// synthetic event's witness is *computed* by RE-RESOLVING its definition against
// the updated grant context.
//
// The stored template is FROZEN: rehydration only adds `eventFirings` entries; it
// never re-mints ids or rewrites statements (the id is persisted and read, never
// re-derived). The re-resolution rides the existing selector layer, so the edge
// cases fall out for free: `LATER_OF` is an open upper bound (never
// resolves until its event fires → no premature witness), and a re-resolved
// witness overrides any prior synthetic firing (back-dated-correction-friendly).

import type {
  Blocker,
  EvaluationContextInput,
  SourceMap,
  VestingNodeExpr,
} from "@vestlang/types";
import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { createEvaluationContext } from "../utils.js";
import { evaluateVestingNodeExpr } from "../evaluate/selectors.js";
import { isPickedResolved, type PickReturn } from "../evaluate/utils.js";

export interface RehydrateResult {
  // The stored runtime with newly-resolved synthetic witnesses merged into
  // `eventFirings` (a re-resolution overrides a prior firing for the same id).
  runtime: VestingRuntime;
  // Synthetic events still pending — their definitions didn't resolve against the
  // current world (e.g. the named event hasn't fired). Advisory, like the
  // `template`-arm blockers at emit time.
  blockers: Blocker[];
}

/**
 * Re-parse a stored source-map definition back into a `VestingNodeExpr`, through
 * the same production pipeline that produced it (`parse` → `normalizeProgram`),
 * so it re-normalizes to the identical canonical shape — the `parse ∘ stringify`
 * fixpoint rehydration relies on.
 *
 * The definition is a bare anchor expression, so it is wrapped as the `FROM`
 * anchor of a throwaway statement (`OverEveryOpt` has an empty-string fallback,
 * so no `OVER/EVERY` is needed) and its `vesting_start` extracted.
 */
export const reparseDefinition = (definition: string): VestingNodeExpr => {
  const program = normalizeProgram(parse(`VEST FROM ${definition}`));
  const expr = program[0].expr;
  if (expr.type !== "SINGLETON") {
    throw new Error(
      `reparseDefinition: expected a SINGLETON schedule, got ${expr.type}`,
    );
  }
  return expr.vesting_start;
};

/** Blockers of a non-resolved pick — mirrors the extraction in resolveStatements. */
const blockersOf = (res: PickReturn<unknown>): Blocker[] => {
  if (res.type === "PICKED") {
    return res.meta.type === "UNRESOLVED" ? res.meta.blockers : [];
  }
  return res.blockers;
};

/**
 * Re-resolve every synthetic event in `sourceMap` against the (now-updated) grant
 * context and merge the computed witnesses into the frozen template's runtime.
 *
 * @param template  the stored, frozen canonical spec (read-only; supplies which
 *                  synthetic ids are genuinely part of the spec).
 * @param sourceMap the externalized gate definitions (`event_id → { definition }`).
 * @param runtime   the stored runtime; its structural fields (startDate, grantDate,
 *                  …) and any existing firings carry through untouched.
 * @param ctxInput  the world: `events` (now including fired named events like
 *                  `ipo`), `asOf`, etc. — how vestlang learns a named event fired.
 */
export const rehydrate = (
  template: VestingScheduleTemplate,
  sourceMap: SourceMap,
  runtime: VestingRuntime,
  ctxInput: EvaluationContextInput,
): RehydrateResult => {
  const ctx = createEvaluationContext(ctxInput);

  // Only resolve ids that are genuinely EVENT statements in the frozen spec —
  // never fabricate a firing for an id the template doesn't reference.
  const templateEventIds = new Set(
    template.statements
      .filter((s) => s.vesting_base.type === "EVENT")
      .map((s) => (s.vesting_base as { event_id: string }).event_id),
  );

  // Seed from the stored firings (preserves order + any non-synthetic firings),
  // then override/insert each resolved synthetic witness by event_id.
  const firings = new Map<
    string,
    NonNullable<VestingRuntime["eventFirings"]>[number]
  >((runtime.eventFirings ?? []).map((f) => [f.event_id, f]));
  const blockers: Blocker[] = [];

  for (const [eventId, entry] of Object.entries(sourceMap)) {
    if (!templateEventIds.has(eventId)) continue;
    const res = evaluateVestingNodeExpr(
      reparseDefinition(entry.definition),
      ctx,
    );
    if (isPickedResolved(res)) {
      firings.set(eventId, { event_id: eventId, date: res.meta.date });
    } else {
      blockers.push(...blockersOf(res));
    }
  }

  const eventFirings = [...firings.values()];
  return {
    runtime: {
      ...runtime,
      ...(eventFirings.length > 0 ? { eventFirings } : {}),
    },
    blockers,
  };
};
