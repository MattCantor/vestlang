import type { ResolveResult } from "@vestlang/evaluator";
import type { NonTemplateReason, Program } from "@vestlang/types";
import { some } from "@vestlang/walk";

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

  // A non-empty, fully-resolved projection to feed the inferrer. (The events arm
  // is ResolvedInstallment[], so it's complete by construction; a pending program
  // is `unresolved`, never `events`, and is turned away before reaching here.)
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

// True if any vesting anchor reachable from the program is an EVENT.
//
// An EVENT doesn't only show up as the start — it can hide in a cliff, in the
// reference node of a BEFORE/AFTER gate, and inside the arms of a LATER OF /
// EARLIER OF selector. Rather than re-spell that recursion by hand (and risk
// missing a spot), we let the shared walker visit every node and just ask at
// each one whether it's an EVENT.
export function hasEventBase(program: Program): boolean {
  return program.some((stmt) => some(stmt, (n) => n.type === "EVENT"));
}
