// The interchange verdict: what a record keeper could store for a schedule,
// answered WITHOUT looking at which events have actually fired.
//
// The trick is that we already have a function that lowers a program to a single
// canonical template — `buildTemplate`. The only reason its usual output depends
// on fired events is that the statements are resolved against `ctx.events` first.
// So to get the firing-invariant answer we resolve in `interchange` mode: the
// built context for that mode carries no `events` field at all (#320), so the
// single EVENT read (in interpret/vestingNode/vestingBase.ts) has nothing to read
// and returns "not fired" — an event-anchored start rides across as a
// deferred/synthetic event, and a future calendar date still resolves on its own.
// An EARLIER_OF never commits here either (the commit is gated on `resolution`
// mode), so a settled date arm doesn't collapse the gate. Re-run it after any
// event fires and you get the same verdict — which is what makes it safe to store.
// Firing-invariance is enforced by the context type now, not just by the mode
// check: a firing read on an interchange-typed context is a compile error. The
// write-side narrow below (`toStoredTerms`) iterates the canonical key set rather
// than re-listing the field names, so a field added to `RuntimeBase` is carried
// through here automatically — it can't be silently dropped on the way to storage.

import type {
  ResolutionContextInput,
  InterchangeVerdict,
  NonTemplateReason,
  Program,
  RuntimeBase,
  StoredTerms,
  VestingRuntime,
} from "@vestlang/types";
import { RUNTIME_BASE_KEYS } from "@vestlang/types";
import { assertValidVestingScheduleTemplate } from "@vestlang/core";
import { stringifyVestingNodeExpr } from "@vestlang/render";
import { createEvaluationContext } from "../utils.js";
import {
  resolveStatements,
  buildTemplate,
  type StmtResolution,
  type TemplateBuild,
} from "./lower.js";
import { classify } from "./classify.js";
import { brandStatic } from "../interpret/blockerTree.js";

/**
 * Why an unresolved build can't be stored, read off the per-statement records.
 * Three distinct causes, in precedence order:
 *
 *   - IMPOSSIBLE_COMPONENT a statically-impossible component (a contradictory start,
 *                          true regardless of firings) coexists with a live pending
 *                          portion. The hardest constraint — it can never be stored
 *                          no matter what fires — so it leads, ahead of the tail and
 *                          cliff causes both (#381).
 *   - EVENT_CHAINED_TAIL   a THEN tail sits behind a head still waiting on an event,
 *                          with no cliff anywhere — the tail just can't be dated yet.
 *   - DEFERRED_CLIFF       a cliff that can't be placed until some firing is known.
 *
 * (The old EVENT_CLIFF cause is gone: an event-held cliff now stores as a template
 * — a time `cliff` plus an `event_condition` — so it never lands in this build at
 * all. `unrepresentable` is largely vacated for cliffs.)
 *
 * The cliff cause wins over the tail one: a chained tail behind a pending head can
 * coexist with a cliff elsewhere — or carry one itself — and the cliff is the harder
 * constraint to act on.
 * DEFERRED_CLIFF is also the catch-all when nothing more specific is identifiable.
 */
const unresolvedReason = (resolutions: StmtResolution[]): NonTemplateReason => {
  // A statically-impossible component leads. Such a start (e.g. a date dated
  // strictly before its own date — a contradiction with no firing involved) trips
  // the IMPOSSIBLE-start guard in lower.ts, which routes the whole build to
  // `unresolved()` *before* contingent-start promotion. On its own it would roll
  // the interchange up to `impossible`; but paired with a live pending portion (a
  // still-pending event head isn't void, so it survives isVoid/classify), the
  // program lands `unresolved` here instead, and the soft chained-tail/cliff
  // reasons would mask the hard fact that this grant can never be stored at all. So
  // the impossibility is the headline. We still carry the coexisting pending head's
  // event (when nameable) as an optional `eventId`, so the live part isn't lost
  // from the reason — but the impossibility leads, ahead of cliffs and firings.
  if (resolutions.some((r) => r.start.state === "IMPOSSIBLE")) {
    const head = pendingHeadEvent(resolutions);
    // Carry the coexisting pending head's event when one is nameable; omit the key
    // entirely otherwise (not a materialized `eventId: undefined`).
    return {
      kind: "IMPOSSIBLE_COMPONENT",
      ...(head !== undefined ? { eventId: head } : {}),
    };
  }

  const hasDeferredCliff = resolutions.some(
    (r) => r.cliff.state === "UNRESOLVED",
  );
  if (!hasDeferredCliff) {
    // A pending chained tail with no deferred cliff and no impossible component (the
    // impossible-component case was already taken above). The build still routed to
    // `unresolved` because a head can't hand off a date yet — its grid is held on an
    // unfired event cliff (#412), so the tail can't be placed. (A lone single-event-
    // head THEN chain promotes to a contingent-start `template` in buildTemplate, so
    // a plain pending-event head never reaches here on its own.) The tail walks back
    // to that held head, and the reason names the event it waits on:
    // EVENT_CHAINED_TAIL.
    const head = pendingHeadEvent(resolutions);
    if (head !== undefined)
      return { kind: "EVENT_CHAINED_TAIL", eventId: head };
  }
  return { kind: "DEFERRED_CLIFF" };
};

/**
 * The event a chained tail is waiting on: a THEN tail whose start went UNRESOLVED
 * because its chain head can't hand off a date yet. Two ways a head holds:
 *   - its *start* is a pending event (a bare `FROM EVENT x`, or a
 *     combinator/gated/offset start), or
 *   - its start is dated but its *cliff* is held on an unfired event (`CLIFF EVENT x`,
 *     `CLIFF LATER OF(…, EVENT x)`) — firing-blind, every such cliff reads unfired,
 *     so the held grid never ends and the tail can't be placed (#412).
 *
 * We walk back from each pending tail to the nearest non-chained head and read what
 * it waits on — the named event for a single bare event, or the anchor/cliff DSL
 * definition for a combinator/gated/offset side (no synthetic id exists yet on this
 * path; the definition is the same dedup key `buildTemplate` would mint one from, and
 * naming it routes the caller to DEFERRED_CLIFF since it isn't a single event id).
 * Undefined when no chained tail is pending on a head we can name.
 */
const pendingHeadEvent = (
  resolutions: StmtResolution[],
): string | undefined => {
  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    // A pending-tail is a chained tail whose start went UNRESOLVED behind a head
    // that can't hand off a date — exactly the role's definition, so no separate
    // start-state clause is needed.
    if (r.chain.role !== "pending-tail") continue;
    for (let j = i - 1; j >= 0; j--) {
      const head = resolutions[j];
      // Walk back past every earlier segment of the same chain (dated tails as
      // well as pending ones) to reach the head that actually anchors it.
      if (head.chain.role !== "head") continue;
      if (head.start.state === "PENDING_EVENT") return head.start.eventId;
      if (head.start.state === "SYNTHETIC_EVENT")
        return stringifyVestingNodeExpr(head.start.expr);
      // A dated head whose grid is held on an unfired event cliff. A bare event side
      // names its real event (→ EVENT_CHAINED_TAIL); a synthetic side (multiple
      // events, an offset, a gate) has no single id to name. In the synthetic case
      // we `break` (not `return undefined`) so the outer scan keeps looking at later
      // pending-tails: a sibling chain on a bare-event head can still name its event,
      // and only if NONE can does the caller fall back to DEFERRED_CLIFF. This is a
      // deliberate first-match-then-continue, consistent with the sibling terminals
      // above — it's a label refinement, not a precedence change (#381 owns ordering).
      if (
        head.cliff.state === "EVENT_HELD" &&
        head.cliff.firing === undefined
      ) {
        if (head.cliff.event.kind === "bare") return head.cliff.event.eventId;
        break;
      }
      break; // the head resolved to something datable — not this cause
    }
  }
  return undefined;
};

// `Object.keys` widens to `string[]`; the set's own keys are exactly
// `keyof RuntimeBase` (forced by its `satisfies` in canonical.ts), so the cast is
// sound. Hoisted so iterating it costs no per-call allocation.
const RUNTIME_BASE_KEY_LIST = Object.keys(
  RUNTIME_BASE_KEYS,
) as (keyof RuntimeBase)[];

// Copy one present field across. The generic `K` ties the read and the write to
// the same key so they share a type — without it the union-indexed `into[k] =
// from[k]` doesn't check (TS can't see `k` picks the same property on both sides).
const carryField = <K extends keyof RuntimeBase>(
  from: RuntimeBase,
  into: RuntimeBase,
  k: K,
): void => {
  const value = from[k];
  if (value !== undefined) into[k] = value;
};

// Project a runtime onto the firing-free `StoredTerms` shape: keep every
// `RuntimeBase` field, drop `eventFirings` (which lives only on VestingRuntime).
// Iterating the canonical key set rather than re-listing names is what makes that
// carry complete — a field added to the set flows through with no edit here, so it
// can't be silently lost on the way to storage (#417). A present field is copied;
// an absent one is left off entirely (no materialized `key: undefined`).
//
// Exported at module level (not the package index) so the eventFirings-drop is
// unit-testable: it's unreachable through the firing-blind entry `resolveInterchange`.
export const toStoredTerms = (runtime: VestingRuntime): StoredTerms => {
  const stored: RuntimeBase = {};
  for (const k of RUNTIME_BASE_KEY_LIST) carryField(runtime, stored, k);
  return stored;
};

/**
 * Translate a template-build outcome into the storable-floor verdict.
 *
 * We hand the non-template builds to the ordinary `classify` rather than reading
 * `build.why` directly, for one reason: a genuinely self-contradictory schedule
 * (a date forced to fall after a strictly later date) and a schedule that merely
 * can't pin down its cliff both surface as `why: "unresolved"` here, and only
 * `classify` tells them apart — it rolls a fully-dead program up to `impossible`.
 */
const mapTemplateBuild = (build: TemplateBuild): InterchangeVerdict => {
  if (build.ok) {
    assertValidVestingScheduleTemplate(build.template);
    return {
      status: "template",
      template: build.template,
      // The interchange path is firing-blind, so its build never populates
      // eventFirings; project the runtime onto StoredTerms (where eventFirings is
      // unrepresentable) by keeping the `RuntimeBase` fields and dropping the
      // firing channel. The structural-field carry is driven by the canonical key
      // set, so it's complete by construction; only `eventFirings` is dropped.
      runtime: toStoredTerms(build.runtime),
      sourceMap: build.sourceMap,
    };
  }

  // The interchange path is firing-blind and never builds a breakdown, so it reads
  // only the verdict off the classify result and discards the partition.
  const v = classify(build).verdict;
  switch (v.kind) {
    case "events":
      // Independent date grids and multiple start origins stay events-only here
      // too — they're firing-invariant. An event-held cliff no longer reaches this
      // arm: it stores as a template (a time `cliff` + an `event_condition`), so
      // the verdicts agree on it rather than splitting events-only/unrepresentable.
      return {
        status: "events-only",
        installments: v.installments,
        reason: v.reason,
      };
    case "impossible":
      // Firing-blind, so these are static contradictions — brand them so the type
      // can't be confused with a resolution-space `dead` blocker.
      return { status: "impossible", blockers: brandStatic(v.blockers) };
    case "unresolved":
      // Nothing storable to hand over — but say *why* off the per-statement
      // records, not off how the build routed. Several distinct facts route here
      // firing-blind (an event cliff always reads unfired, a chained tail behind a
      // pending event has no dates yet), and collapsing them all to the generic
      // deferred-cliff reason would mislabel a build with no cliff at all.
      return {
        status: "unrepresentable",
        reason: unresolvedReason(build.resolutions),
      };
  }
};

/**
 * Compute the interchange verdict for a program. Mirrors `resolveToCore`'s setup
 * but resolves against an events-blind context. The entry points run this after
 * `resolveToCore`, which already enforces the installment cap, so we don't repeat
 * that check here.
 */
export const resolveInterchange = (
  program: Program,
  ctxInput: ResolutionContextInput,
): InterchangeVerdict => {
  // Building under `interchange` mode yields a context with no `events` field at
  // all (the builder omits it on this branch, #320), so the EVENT read is
  // firing-blind by type — every named event reads "not fired", and a firing read
  // anywhere on this context wouldn't compile. The input still carries `events`
  // (it's validated either way); the build is just where the map stops here.
  const ctx = createEvaluationContext(ctxInput, "interchange");
  const build = buildTemplate(resolveStatements(program, ctx), ctx);
  return mapTemplateBuild(build);
};
