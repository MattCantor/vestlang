import type { ResolveResult } from "@vestlang/evaluator";
import type { NonTemplateReason, Program } from "@vestlang/types";
import { referencesEvent } from "@vestlang/walk";

// The events arm of the classifier's verdict — the only shape recovery acts on.
type EventsResult = Extract<ResolveResult, { kind: "events" }>;

// Whether an events-only verdict is safe to attempt template recovery on.
//
// Recovery substitutes an inferred template for the authored program, so it's
// only sound when that template is equivalent for ALL inputs — not just the one
// projection we happened to sample. That holds exactly for firing-INVARIANT
// programs: overlapping absolute-date grids, where there's no event firing to
// vary. Anything event-anchored is firing-dependent — a template inferred from
// one firing bakes that firing in — so it's rejected here, before we ever infer.
//
// The caller has already established `result.kind === "events"` (the cheap path
// short-circuits everything else), so this only weighs the remaining conditions.
export function admitsRecovery(result: EventsResult, stmts: Program): boolean {
  // Must be the overlapping-grids reason, not an event-anchored cliff. This
  // gates on the structured `kind`, never the prose `detail`.
  if (!isOverlappingAbsoluteStarts(result.reason)) return false;

  // A non-empty projection to feed the inferrer. The events arm can carry
  // symbolic installments for a sibling portion still waiting on an event, but
  // any such program references an event and the anchor check below turns it
  // away — what survives the gate is fully dated.
  if (result.installments.length === 0) return false;

  // The load-bearing check. OVERLAPPING_ABSOLUTE_STARTS is raised by two
  // structurally different collisions: a pure two-DATE-grid overlap, and an
  // event-origin THEN chain whose segments land on one event at different dates.
  // They're indistinguishable by reason `kind` — only `detail` differs, and we
  // won't parse prose. So we go to the source: if any anchor in the authored
  // program is an EVENT, the projection is firing-dependent and we bail.
  if (hasEventBase(stmts)) return false;

  return true;
}

function isOverlappingAbsoluteStarts(reason: NonTemplateReason): boolean {
  return reason.kind === "OVERLAPPING_ABSOLUTE_STARTS";
}

// True if any vesting anchor reachable from the program is an EVENT — checked
// per statement via the shared `referencesEvent` predicate, which descends the
// base, cliff, gate condition, and selector arms so no placement is missed.
export function hasEventBase(program: Program): boolean {
  return program.some(referencesEvent);
}
