// Rehydration: turn a stored canonical artifact + the world's named-event
// firings into the witnesses each EVENT-anchored statement waits on.
//
// Lowering a start a bare EVENT base can't hold (a combinator over anchors, a
// gate, an offset anchor) into a `template` externalizes it as a grant-scoped
// synthetic event (`evt:<n>`) with no firing and a source-map definition (its
// DSL). A bare `EVENT ipo` start needs no sidecar — the template names it in
// full as its own `event_id`. Rehydration is the inverse half: once the world's
// named events fire (the IPO happens, attested by the caller in `ctx.events`,
// the same channel `evaluateVestingBase` already reads), each event's witness is
// computed by re-resolving its definition against the updated grant context —
// the synthetic's from the sidecar, the bare's from the trivial `EVENT <id>`.
//
// The stored template is frozen. Rehydration only adds `eventFirings` entries; it
// never re-mints ids or rewrites statements (the id is persisted and read, never
// re-derived). The re-resolution rides the existing selector layer, so the edge
// cases fall out for free: a `LATER_OF` is an open upper bound that doesn't
// resolve until its event fires (no premature witness), and a re-resolved witness
// overrides any prior synthetic firing (which keeps back-dated corrections sane).

import type {
  Blocker,
  DeadBlocker,
  EvaluationContextInput,
  SourceMap,
  UnresolvedBlocker,
  VestingNodeExpr,
} from "@vestlang/types";
import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { createEvaluationContext } from "../utils.js";
import { evaluateVestingNodeExpr } from "../evaluate/selectors.js";
import { partitionResolutionBlockers } from "../evaluate/blockerTree.js";
import { isPickedResolved, type PickReturn } from "../evaluate/utils.js";
import { isSyntheticEventId } from "./synthetic.js";

export interface RehydrateResult {
  // The stored runtime with newly-resolved synthetic witnesses merged into
  // `eventFirings` (a re-resolution overrides a prior firing for the same id).
  runtime: VestingRuntime;
  // Gates whose definitions didn't resolve against the current world, split by the
  // closed-world reading: `pending` is still-waiting (the named event hasn't
  // fired), `dead` can never resolve given the firings we now know (it fired
  // outside its window). Both always present, disjoint. Advisory, like the
  // `template`-arm blockers at emit time.
  pending: UnresolvedBlocker[];
  dead: DeadBlocker[];
}

/**
 * Re-parse a stored source-map definition back into a `VestingNodeExpr`, through
 * the same production pipeline that produced it (`parse` → `normalizeProgram`),
 * so it re-normalizes to the identical canonical shape, the `parse`/`stringify`
 * fixpoint that rehydration relies on.
 *
 * The definition is a bare anchor expression, so it is wrapped as the `FROM`
 * anchor of a throwaway statement (`OverEveryOpt` has an empty-string fallback,
 * so no `OVER/EVERY` is needed) and its `vesting_start` extracted.
 */
export const reparseDefinition = (definition: string): VestingNodeExpr => {
  const program = normalizeProgram(parse(`VEST FROM ${definition}`));
  const stmt = program[0];
  // The wrapper is a single ordinary `VEST FROM …` statement, so it is never a
  // chained tail; the guard is what lets us read its start as non-null.
  if (stmt.chained) {
    throw new Error("reparseDefinition: unexpected chained statement");
  }
  if (stmt.expr.type !== "SCHEDULE") {
    throw new Error(
      `reparseDefinition: expected a single schedule, got ${stmt.expr.type}`,
    );
  }
  return stmt.expr.vesting_start;
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
 *                  `ipo`), `asOf`, etc.; this is how vestlang learns an event fired.
 */
export const rehydrate = (
  template: VestingScheduleTemplate,
  sourceMap: SourceMap,
  runtime: VestingRuntime,
  ctxInput: EvaluationContextInput,
): RehydrateResult => {
  // The grant's frozen conventions come from the stored runtime, not the caller.
  // Grant date and day-of-month were fixed at issuance, so the witnesses we
  // re-resolve here must read the same values the projection compiles under —
  // otherwise an offset synthetic (e.g. `EVENT ipo + 1 month`) could land a day
  // off the projection grid. The caller still owns world/observer state (events,
  // asOf) and grantQuantity; the matching ctxInput grant-date / day-of-month
  // fields are deliberately ignored. The grant-date fallback only matters for a
  // hand-built artifact that omits runtime.grantDate — a persisted one always
  // carries it. day-of-month is set unconditionally: when the grant used the
  // default rule lower.ts doesn't store it, so this is undefined and
  // createEvaluationContext re-applies the same canonical default the projection
  // uses.
  const ctx = createEvaluationContext({
    ...ctxInput,
    grantDate: runtime.grantDate ?? ctxInput.grantDate,
    vesting_day_of_month: runtime.vestingDayOfMonth,
  });

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

  // The sidecar only covers synthetic ids; a bare `EVENT ipo` names itself in the
  // template's `vesting_base` and has no sidecar entry, so it's the templateEventIds
  // the loop above never visited. Resolve each through the same selector — its
  // trivial definition is just `EVENT <id>` — so its witness and its
  // EVENT_NOT_YET_OCCURRED blocker fall out in the identical shape to a synthetic.
  for (const eventId of templateEventIds) {
    if (eventId in sourceMap) continue;
    // A synthetic id with no sidecar entry is a template whose definitions were
    // dropped: deliberately opaque, so it resolves to no witness. Don't reparse it
    // as `EVENT <id>` — its colon isn't a legal bare name and the parser would throw.
    if (isSyntheticEventId(eventId)) continue;
    const res = evaluateVestingNodeExpr(
      reparseDefinition(`EVENT ${eventId}`),
      ctx,
    );
    if (isPickedResolved(res)) {
      // A supplied firing overrides any firing seeded from the stored runtime, so a
      // corrected/back-dated date in `events` takes effect.
      firings.set(eventId, { event_id: eventId, date: res.meta.date });
    } else if (!firings.has(eventId)) {
      // Disclose as pending only when no stored firing already carries it. If the
      // artifact was persisted after the event fired, the stored firing stands and
      // we don't report it pending — that would say it vests AND waits at once.
      // (Whether an omitted firing should instead read as a rescission is #284.)
      blockers.push(...blockersOf(res));
    }
  }

  const eventFirings = [...firings.values()];
  // Split the gathered blockers by their closed-world reading once, at the boundary.
  const { pending, dead } = partitionResolutionBlockers(blockers);
  return {
    runtime: {
      ...runtime,
      ...(eventFirings.length > 0 ? { eventFirings } : {}),
    },
    pending,
    dead,
  };
};
