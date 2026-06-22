// Rehydration: turn a stored canonical artifact + the world's named-event firings
// into the contingent start's real date, surfaced read-only.
//
// A contingent start (its calendar date unknown until a named event fires) is
// stored as a DATE base whose `runtime.startDate` is the CONTINGENT_START_SENTINEL,
// with the start's recipe externalized under the one reserved `evt:start` sidecar
// key (its `@vestlang/render` DSL). Rehydration is the inverse half: once the
// world's named events fire (the IPO happens, attested by the caller in
// `ctx.events`, the same channel `evaluateVestingBase` reads), the start's witness
// is re-derived by resolving that recipe against the updated grant context.
//
// The stored artifact is FROZEN and stays contingent forever (it bakes no date —
// firing-invariant by construction, so a later backdated correction re-derives
// cleanly). Rehydration never mutates it: it emits the re-derived date and a
// projection-only runtime (startDate substituted with the real date), which the
// caller compiles against. The re-resolution rides the existing selector layer, so
// the edge cases fall out for free: a `LATER_OF` is an open upper bound that
// doesn't resolve until its event fires (no premature witness), and a re-resolved
// witness takes the corrected date directly (back-dated corrections stay sane).

import type {
  Blocker,
  DeadBlocker,
  OCTDate,
  ResolutionContextInput,
  SourceMap,
  UnresolvedBlocker,
  VestingNodeExpr,
} from "@vestlang/types";
import type {
  StoredTerms,
  VestingRuntime,
  VestingScheduleTemplate,
} from "@vestlang/types";
import { CONTINGENT_START_SENTINEL } from "@vestlang/core";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { createEvaluationContext } from "../utils.js";
import { evaluateVestingNodeExpr } from "../evaluate/selectors.js";
import { partitionResolutionBlockers } from "../evaluate/blockerTree.js";
import { isPickedResolved, type PickReturn } from "../evaluate/utils.js";
import {
  assertReloadKeysReserved,
  SYNTHETIC_START_EVENT_ID,
} from "./synthetic.js";

export interface RehydrateResult {
  // The projection-only runtime: the stored runtime with a resolved contingent
  // start substituted into `startDate` (so the caller compiles a real projection).
  // When the `evt:start` recipe is unresolved (event not fired) the sentinel stays,
  // and the compiler's sentinel-skip projects nothing; when there's no contingent
  // start at all the stored runtime carries through unchanged. The STORED artifact
  // is never mutated — this is a fresh runtime.
  runtime: VestingRuntime;
  // The newly-derived contingent start, when the `evt:start` recipe resolved on
  // this reload; null when it's unresolved or there is no contingent start.
  // Re-emitted on every reload where the start resolves (the artifact stays
  // contingent — Decision 8 — so this is idempotent).
  startToApply: { date: OCTDate } | null;
  // The contingent start's blockers when its recipe didn't resolve, split by the
  // closed-world reading: `pending` is still-waiting (the event hasn't fired),
  // `dead` can never resolve (it fired outside its window). Both always present,
  // disjoint. Advisory, like the `template`-arm blockers at emit time.
  pending: UnresolvedBlocker[];
  dead: DeadBlocker[];
}

// Thrown when a stored artifact carries a contingent-start recipe that no longer
// reparses to a single clean anchor — a corrupt or hand-edited sidecar. The
// artifact is untrusted input (it lives in external storage and may be
// hand-edited), so this is the engine's signal that it is genuinely damaged, not a
// transient pending state.
//
// Boundaries discriminate this by the literal `name` tag, NOT `instanceof`: the
// evaluator can be loaded across module realms (a CJS consumer alongside this ESM
// build), where `instanceof` against a duplicated class silently misses. Use
// `isRehydrateDefinitionError` and key on the tag.
//
// The underlying parser/grammar throw is carried on `cause` for logging only — it
// is the raw `Expected "DATE", …` text and must not be surfaced to an operator.
export class RehydrateDefinitionError extends Error {
  readonly name = "RehydrateDefinitionError";
  // The reserved key whose recipe failed to reparse, so the refusal can name it.
  readonly event_id: string;
  // The exact string that failed to reparse (for diagnostics).
  readonly definition: string;
  // The original throw (peggy SyntaxError, a shape guard, a semantic-action error).
  readonly cause: unknown;

  constructor(args: { event_id: string; definition: string; cause: unknown }) {
    super(`Could not reparse the stored recipe for "${args.event_id}".`);
    this.event_id = args.event_id;
    this.definition = args.definition;
    this.cause = args.cause;
  }
}

export const isRehydrateDefinitionError = (
  e: unknown,
): e is RehydrateDefinitionError =>
  e instanceof Error && e.name === "RehydrateDefinitionError";

// Thrown when a stored artifact carries the contingent-start sentinel in
// `runtime.startDate` but has no `evt:start` recipe to re-derive the real date —
// the contingency marker was dropped, so the artifact is corrupt (it would project
// an obviously-wrong far-future schedule, or nothing). A pure corruption guard
// reading the sentinel VALUE (not the rehydrate override decision, which keys on
// the recipe's presence). Tagged like the other reload refusals.
export class RehydrateMissingStartMarkerError extends Error {
  readonly name = "RehydrateMissingStartMarkerError";
  constructor() {
    super(
      `The artifact's startDate is the contingent-start sentinel but it carries no "${SYNTHETIC_START_EVENT_ID}" recipe to re-derive the real start.`,
    );
  }
}

export const isRehydrateMissingStartMarkerError = (
  e: unknown,
): e is RehydrateMissingStartMarkerError =>
  e instanceof Error && e.name === "RehydrateMissingStartMarkerError";

/**
 * Re-parse a stored source-map recipe back into a `VestingNodeExpr`, through the
 * same production pipeline that produced it (`parse` → `normalizeProgram`), so it
 * re-normalizes to the identical canonical shape, the `parse`/`stringify` fixpoint
 * that rehydration relies on.
 *
 * The recipe is a bare anchor expression, so it is wrapped as the `FROM` anchor of
 * a throwaway statement (`OverEveryOpt` has an empty-string fallback, so no
 * `OVER/EVERY` is needed) and its `vesting_start` extracted.
 *
 * Any throw here (a peggy parse error, a grammar semantic-action error, or one of
 * the shape guards below) is intentional — the call site wraps it into a
 * `RehydrateDefinitionError`.
 */
export const reparseDefinition = (definition: string): VestingNodeExpr => {
  const program = normalizeProgram(parse(`VEST FROM ${definition}`));
  // The wrapper is one bare `VEST FROM <anchor>` statement, so a valid recipe
  // always yields exactly one. A longer program means the recipe smuggled in a
  // statement connector (`PLUS`, a `THEN` tail), so `program[0]` would silently
  // drop the rest — refuse it as corruption rather than truncate.
  if (program.length !== 1) {
    throw new Error(
      `reparseDefinition: expected a single statement, got ${program.length}`,
    );
  }
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

// Reparse, converting any failure into the tagged error naming the reserved key.
const reparseRecipe = (
  eventId: string,
  definition: string,
): VestingNodeExpr => {
  try {
    return reparseDefinition(definition);
  } catch (cause) {
    throw new RehydrateDefinitionError({
      event_id: eventId,
      definition,
      cause,
    });
  }
};

/** Blockers of a non-resolved pick — mirrors the extraction in resolveStatements. */
const blockersOf = (res: PickReturn<unknown>): Blocker[] => {
  if (res.type === "PICKED") {
    return res.meta.type === "UNRESOLVED" ? res.meta.blockers : [];
  }
  return res.blockers;
};

/**
 * Re-derive a stored artifact's contingent start against the (now-updated) grant
 * context and emit a projection-only runtime carrying the resolved date — without
 * touching the frozen artifact.
 *
 * @param template  the stored, frozen canonical spec (read-only). DATE-only bases;
 *                  not otherwise consulted here (the start lives on the runtime +
 *                  sidecar).
 * @param sourceMap the externalized start recipe (`evt:start → { definition }`),
 *                  empty for a plain dated schedule or a dropped sidecar.
 * @param runtime   the stored runtime — `StoredTerms`, firing-free. Its structural
 *                  fields (startDate, grantDate, …) carry through; a contingent
 *                  start's sentinel startDate is replaced with the re-derived date.
 * @param ctxInput  the world: `events` (now including fired named events like
 *                  `ipo`). Re-resolving a witness reads structural state only, so
 *                  no observation time enters here.
 */
export const rehydrate = (
  template: VestingScheduleTemplate,
  sourceMap: SourceMap,
  runtime: StoredTerms,
  ctxInput: ResolutionContextInput,
): RehydrateResult => {
  // Before anything else: every present source-map key must be a reserved synthetic
  // id (`evt:start`, or a numbered `evt:<n>`). A stray key (e.g. `evt_1`, a legal
  // user Ident, or `evt:bogus`) aliases a real user event — re-resolving its
  // tampered recipe would shadow a genuine firing. A dropped sidecar yields an
  // empty map, so this never fires on the legitimate opaque path.
  assertReloadKeysReserved(sourceMap);

  // Damaged-artifact guard (pure corruption check reading the sentinel VALUE — see
  // CONTINGENT_START_SENTINEL — NOT the override decision below, which keys on the
  // recipe's presence). A sentinel startDate with no `evt:start` recipe means the
  // contingency marker was dropped: there's nothing to re-derive the real date
  // from, so the artifact would project an obviously-wrong far-future schedule.
  const hasSentinelStart = runtime.startDate === CONTINGENT_START_SENTINEL;
  const hasStartRecipe = Object.hasOwn(sourceMap, SYNTHETIC_START_EVENT_ID);
  if (hasSentinelStart && !hasStartRecipe) {
    throw new RehydrateMissingStartMarkerError();
  }

  // The grant's frozen conventions come from the stored runtime, not the caller.
  // Grant date and day-of-month were fixed at issuance, so the start we re-resolve
  // here reads the same values the projection compiles under. The caller still owns
  // world state (events) and grantQuantity; the matching ctxInput grant-date /
  // day-of-month fields are deliberately ignored. The grant-date fallback only
  // matters for a hand-built artifact that omits runtime.grantDate — a persisted
  // one always carries it. day-of-month is set unconditionally: when the grant used
  // the default rule lower.ts doesn't store it, so this is undefined and
  // createEvaluationContext re-applies the same canonical default the projection
  // uses.
  //
  // `rehydrate` mode: read the world's attested firings, but DO NOT commit. An
  // EARLIER_OF stored start must stay pending on reload until a real witness fires —
  // committing it to its date floor here would fabricate a firing the world never
  // produced (AC 10).
  const ctx = createEvaluationContext(
    {
      ...ctxInput,
      grantDate: runtime.grantDate ?? ctxInput.grantDate,
      vesting_day_of_month: runtime.vestingDayOfMonth,
    },
    "rehydrate",
  );

  // The OVERRIDE decision keys STRICTLY on the presence of the `evt:start` entry,
  // never on the startDate value (keying on "is it still the sentinel" would bake
  // resolved state into the artifact and break firing-invariance). No recipe → the
  // stored runtime carries through unchanged (a plain dated schedule, or a dropped
  // sidecar's opaque start).
  if (!hasStartRecipe) {
    return {
      runtime: { ...runtime },
      startToApply: null,
      pending: [],
      dead: [],
    };
  }

  const recipe = sourceMap[SYNTHETIC_START_EVENT_ID];
  const node = reparseRecipe(SYNTHETIC_START_EVENT_ID, recipe.definition);
  const res = evaluateVestingNodeExpr(node, ctx);

  if (isPickedResolved(res)) {
    // Resolved: substitute the re-derived date into a projection-only runtime so
    // the caller compiles real tranches. The stored artifact keeps the sentinel —
    // this is a fresh runtime, never written back.
    const date = res.meta.date;
    return {
      runtime: { ...runtime, startDate: date },
      startToApply: { date },
      pending: [],
      dead: [],
    };
  }

  // Unresolved (event not fired) or dead (fired outside its window): keep the
  // sentinel so the projection stays empty (the compiler's sentinel-skip), and
  // surface the blockers.
  const { pending, dead } = partitionResolutionBlockers(blockersOf(res));
  return {
    runtime: { ...runtime },
    startToApply: null,
    pending,
    dead,
  };
};
