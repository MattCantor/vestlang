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
  ResolutionContextInput,
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
import { isSyntheticEventId, assertReloadKeysReserved } from "./synthetic.js";

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

// Where a corrupt definition was read from. A `definition` is a sidecar source-map
// entry (a synthetic gate's externalized DSL); a `template-event-name` is the
// `event_id` of a bare `EVENT` statement, reparsed via the trivial `EVENT <id>`.
export type RehydrateDefinitionSource = "definition" | "template-event-name";

// Thrown when a stored artifact carries an event definition that no longer
// reparses to a single clean anchor — a corrupt/edited sidecar or a template event
// id that isn't a legal bare name. The artifact is untrusted input (it lives in
// external storage and may be hand-edited), so this is the engine's signal that it
// is genuinely damaged, not a transient pending state.
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
  // The event whose definition failed to reparse, so the refusal can name it.
  readonly event_id: string;
  readonly source: RehydrateDefinitionSource;
  // The exact string that failed to reparse (for diagnostics; for a bare event
  // name this is the synthesized `EVENT <id>`, not just the id).
  readonly definition: string;
  // The original throw (peggy SyntaxError, a shape guard, a semantic-action error).
  readonly cause: unknown;

  constructor(args: {
    event_id: string;
    source: RehydrateDefinitionSource;
    definition: string;
    cause: unknown;
  }) {
    super(
      `Could not reparse the stored definition for event "${args.event_id}".`,
    );
    this.event_id = args.event_id;
    this.source = args.source;
    this.definition = args.definition;
    this.cause = args.cause;
  }
}

export const isRehydrateDefinitionError = (
  e: unknown,
): e is RehydrateDefinitionError =>
  e instanceof Error && e.name === "RehydrateDefinitionError";

/**
 * Re-parse a stored source-map definition back into a `VestingNodeExpr`, through
 * the same production pipeline that produced it (`parse` → `normalizeProgram`),
 * so it re-normalizes to the identical canonical shape, the `parse`/`stringify`
 * fixpoint that rehydration relies on.
 *
 * The definition is a bare anchor expression, so it is wrapped as the `FROM`
 * anchor of a throwaway statement (`OverEveryOpt` has an empty-string fallback,
 * so no `OVER/EVERY` is needed) and its `vesting_start` extracted.
 *
 * Any throw here (a peggy parse error, a grammar semantic-action error, or one of
 * the shape guards below) is intentional — the call sites wrap it into a
 * `RehydrateDefinitionError` naming the offending event.
 */
export const reparseDefinition = (definition: string): VestingNodeExpr => {
  const program = normalizeProgram(parse(`VEST FROM ${definition}`));
  // The wrapper is one bare `VEST FROM <anchor>` statement, so a valid definition
  // always yields exactly one. A longer program means the definition smuggled in a
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

// Reparse, converting any failure into the tagged error naming the event. `label`
// is the string actually fed to `reparseDefinition` (a sidecar definition, or the
// synthesized `EVENT <id>`), kept distinct from `event_id` for diagnostics.
const reparseForEvent = (
  eventId: string,
  source: RehydrateDefinitionSource,
  label: string,
): VestingNodeExpr => {
  try {
    return reparseDefinition(label);
  } catch (cause) {
    throw new RehydrateDefinitionError({
      event_id: eventId,
      source,
      definition: label,
      cause,
    });
  }
};

// The bare-event loop synthesizes `EVENT <id>` and reparses it, so it must round-
// trip to *exactly the bare floating event it claims* — nothing more. The existing
// reparse guards stop multi-statement smuggling, but a single id can still reparse
// to a valid-but-non-bare anchor and silently shift or fabricate the witness:
//   - `"a + 6 months"` reparses to `EVENT a` with a +6-month offset, moving the date;
//   - `"grant_date"` / `"grantDate"` reparses to the GRANT_DATE *system* anchor
//     (EventRef tries SystemRef before Ident), fabricating a firing where a genuine
//     floating event would stay pending.
// So require the reparsed node to be a plain `NODE` on an EVENT base naming this
// exact id, with no offsets and no gate. Anything else is corruption. This is an
// identity check, not a lexical one, so it closes the offset case and the whole
// system-anchor family without enumerating their spellings.
const assertBareFloatingEvent = (
  eventId: string,
  node: VestingNodeExpr,
): void => {
  const isBare =
    node.type === "NODE" &&
    node.base.type === "EVENT" &&
    node.base.value === eventId &&
    node.offsets.length === 0 &&
    node.condition === undefined;
  if (isBare) return;
  throw new RehydrateDefinitionError({
    event_id: eventId,
    source: "template-event-name",
    definition: `EVENT ${eventId}`,
    cause: new Error(
      `Template event "${eventId}" does not reparse to a bare floating event.`,
    ),
  });
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
 *                  `ipo`); this is how vestlang learns an event fired. Re-resolving
 *                  a witness reads structural installment state only, so no
 *                  observation time enters here.
 */
export const rehydrate = (
  template: VestingScheduleTemplate,
  sourceMap: SourceMap,
  runtime: VestingRuntime,
  ctxInput: ResolutionContextInput,
): RehydrateResult => {
  // Before anything else: every present source-map key must be a reserved synthetic
  // id. A key outside the namespace (e.g. `evt_1`, a legal user Ident) aliases a
  // real user event — re-resolving its tampered definition would shadow the user's
  // genuine firing. Scanned over the raw key set so a stray key with no matching
  // template statement is still caught. A dropped sidecar yields an empty map, so
  // this never fires on the legitimate opaque-template path.
  assertReloadKeysReserved(sourceMap);

  // The grant's frozen conventions come from the stored runtime, not the caller.
  // Grant date and day-of-month were fixed at issuance, so the witnesses we
  // re-resolve here must read the same values the projection compiles under —
  // otherwise an offset synthetic (e.g. `EVENT ipo + 1 month`) could land a day
  // off the projection grid. The caller still owns world state (events) and
  // grantQuantity; the matching ctxInput grant-date / day-of-month fields are
  // deliberately ignored. The grant-date fallback only matters for a
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
      reparseForEvent(eventId, "definition", entry.definition),
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
    // `Object.hasOwn`, not `in`: a bare event named after a prototype key (e.g.
    // `constructor`) would match `in` against the inherited member and be skipped
    // as if it had a sidecar entry, dropping its firing.
    if (Object.hasOwn(sourceMap, eventId)) continue;
    // A synthetic id with no sidecar entry is a template whose definitions were
    // dropped: deliberately opaque, so it resolves to no witness. Don't reparse it
    // as `EVENT <id>` — its colon isn't a legal bare name and the parser would throw.
    if (isSyntheticEventId(eventId)) continue;
    const node = reparseForEvent(
      eventId,
      "template-event-name",
      `EVENT ${eventId}`,
    );
    // Even a successful reparse can denote a shifted or fabricated anchor; require
    // it to be exactly the bare floating event before trusting its witness.
    assertBareFloatingEvent(eventId, node);
    const res = evaluateVestingNodeExpr(node, ctx);
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
