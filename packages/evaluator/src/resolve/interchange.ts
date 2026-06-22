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
// check: a firing read on an interchange-typed context is a compile error.

import type {
  ResolutionContextInput,
  InterchangeVerdict,
  NonTemplateReason,
  Program,
  StoredTerms,
  VestingRuntime,
} from "@vestlang/types";
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
 * Two distinct causes, in precedence order:
 *
 *   - EVENT_CHAINED_TAIL a THEN tail sits behind a head still waiting on an event,
 *                        with no cliff anywhere — the tail just can't be dated yet.
 *   - DEFERRED_CLIFF     a cliff that can't be placed until some firing is known.
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
  const hasDeferredCliff = resolutions.some(
    (r) => r.cliff.state === "UNRESOLVED",
  );
  if (!hasDeferredCliff) {
    // Note: a contingent start now promotes a single-event-head THEN chain to a
    // `template` (see buildTemplate), so this branch no longer fires for that
    // common shape; the kind is retained for contract exhaustiveness. Whether any
    // shape still reaches it — and removing the branch + pendingHeadEvent helper if
    // not — is tracked as a follow-up cleanup.
    const head = pendingHeadEvent(resolutions);
    if (head !== undefined)
      return { kind: "EVENT_CHAINED_TAIL", eventId: head };
  }
  return { kind: "DEFERRED_CLIFF" };
};

/**
 * The event a chained tail is waiting on: a THEN tail whose start went UNRESOLVED
 * because its chain head is a pending event. We walk back from each such tail to the
 * nearest non-chained head and read what it waits on — the named event for a bare
 * `FROM EVENT x`, or the anchor's DSL definition for a combinator/gated/offset head
 * (no synthetic id exists yet on this path; the definition is the same dedup key
 * `buildTemplate` would mint one from). Undefined when no chained tail is pending
 * on a head we can name.
 */
const pendingHeadEvent = (
  resolutions: StmtResolution[],
): string | undefined => {
  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    // A pending-tail is a chained tail whose start went UNRESOLVED behind a head
    // still waiting on an event — exactly the role's definition, so no separate
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
      break; // the head resolved to something datable — not this cause
    }
  }
  return undefined;
};

// Keep only the firing-free structural fields of a runtime. A firing-blind build
// leaves eventFirings unset, so this is the type-narrow that lets the interchange
// template carry a `StoredTerms` runtime.
const toStoredTerms = (runtime: VestingRuntime): StoredTerms => ({
  ...(runtime.startDate !== undefined ? { startDate: runtime.startDate } : {}),
  ...(runtime.grantDate !== undefined ? { grantDate: runtime.grantDate } : {}),
  ...(runtime.vestingDayOfMonth !== undefined
    ? { vestingDayOfMonth: runtime.vestingDayOfMonth }
    : {}),
});

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
      // unrepresentable) by keeping only the structural fields. A type-narrow, not
      // a drop — the seam where firing-invariance becomes a type guarantee.
      runtime: toStoredTerms(build.runtime),
      sourceMap: build.sourceMap,
    };
  }

  const v = classify(build);
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
