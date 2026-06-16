// The interchange verdict: what a record keeper could store for a schedule,
// answered WITHOUT looking at which events have actually fired.
//
// The trick is that we already have a function that lowers a program to a single
// canonical template — `buildTemplate`. The only reason its usual output depends
// on fired events is that the statements are resolved against `ctx.events` first.
// So to get the firing-invariant answer we run the exact same machinery against a
// context with the events map emptied out: every named event then reads as "not
// fired", an event-anchored start rides across as a deferred/synthetic event, and
// a future calendar date still resolves on its own. Re-run it after any event
// fires and you get the same verdict — which is what makes it safe to store.

import type {
  ResolutionContextInput,
  InterchangeVerdict,
  NonTemplateReason,
  OCTDate,
  Program,
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
import { brandStatic } from "../evaluate/blockerTree.js";

/**
 * Why an unresolved build can't be stored, read off the per-statement records.
 * Three distinct causes, in precedence order:
 *
 *   - EVENT_CLIFF        a cliff hangs off a named event — the schema has no home
 *                        for it at all, gated or not (kept firing-invariant:
 *                        blind to firings an event cliff always reads unfired,
 *                        landing here as the EVENT_PENDING record when bare, or as
 *                        an UNRESOLVED record carrying the event id on its shape
 *                        when a pending gate did the routing). Reported the same
 *                        whether the start resolved, is itself pending, or is a
 *                        THEN tail behind a pending head.
 *   - EVENT_CHAINED_TAIL a THEN tail sits behind a head still waiting on an event,
 *                        with no cliff anywhere — the tail just can't be dated yet.
 *   - DEFERRED_CLIFF     a cliff that can't be placed until some firing is known.
 *
 * The cliff causes win over the tail one: a chained tail behind a pending head can
 * coexist with a cliff elsewhere — or carry one itself — and the cliff is the harder
 * constraint to act on.
 * DEFERRED_CLIFF is also the catch-all when nothing more specific is identifiable.
 */
const unresolvedReason = (resolutions: StmtResolution[]): NonTemplateReason => {
  // First statement (program order) whose cliff is event-anchored — an
  // EVENT_PENDING record, or an UNRESOLVED record whose gate routing kept the
  // event id on its shape. The scan runs only on the firing-blind interchange
  // build, where an event cliff always reads unfired, so EVENT_FIRED can't arise
  // here and is intentionally excluded.
  for (const r of resolutions) {
    const c = r.cliff;
    const eventId =
      c.state === "EVENT_PENDING"
        ? c.eventId
        : c.state === "UNRESOLVED" && c.shape.kind !== "dated-floor"
          ? c.shape.eventId
          : undefined;
    if (eventId !== undefined) return { kind: "EVENT_CLIFF", eventId };
  }

  const hasDeferredCliff = resolutions.some(
    (r) => r.cliff.state === "UNRESOLVED",
  );
  if (!hasDeferredCliff) {
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
      sourceMap: build.sourceMap,
    };
  }

  const v = classify(build);
  switch (v.kind) {
    case "events":
      // Two date grids stay events-only here too — they're firing-invariant. An
      // event cliff is the one place the two verdicts disagree: the record keeper
      // can list the dated events for it (so resolution calls it events-only), but
      // it can't store the cliff itself, so the storable answer is "no home".
      // (Firing-blind a cliff event never reads as fired, so the EVENT_CLIFF
      // reason can't actually arrive here anymore; the mapping stays for the
      // exhaustiveness of the contract.)
      return v.reason.kind === "EVENT_CLIFF"
        ? { status: "unrepresentable", reason: v.reason }
        : {
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
  const ctx = createEvaluationContext(ctxInput);
  // grantDate and vestingStart are their own context fields, so blanking `events`
  // drops only the genuine named firings, not the system anchors a start needs.
  // Null-proto so an EVENT atom named after a `Object.prototype` key still reads
  // "not fired" here rather than the inherited value (the firing-blind path).
  const interchangeCtx = {
    ...ctx,
    events: Object.create(null) as Record<string, OCTDate | undefined>,
  };
  const build = buildTemplate(
    resolveStatements(program, interchangeCtx),
    interchangeCtx,
  );
  return mapTemplateBuild(build);
};
