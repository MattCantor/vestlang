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
  EvaluationContextInput,
  InterchangeVerdict,
  Program,
} from "@vestlang/types";
import { assertValidVestingScheduleTemplate } from "@vestlang/core";
import { createEvaluationContext } from "../utils.js";
import {
  resolveStatements,
  buildTemplate,
  type TemplateBuild,
} from "./lower.js";
import { classify } from "./classify.js";

/**
 * Translate a template-build outcome into the storable-floor verdict.
 *
 * We hand the non-template builds to the ordinary `classify` rather than reading
 * `build.why` directly, for one reason: a genuinely self-contradictory schedule
 * (a date forced to fall after a strictly later date) and a schedule that merely
 * can't pin down its cliff both surface as `why: "unresolved"` here, and only
 * `classify` tells them apart — it rolls a fully-dead program up to `impossible`.
 */
const mapTemplateBuild = (
  build: TemplateBuild,
  program: Program,
): InterchangeVerdict => {
  if (build.ok) {
    assertValidVestingScheduleTemplate(build.template);
    return {
      status: "template",
      template: build.template,
      sourceMap: build.sourceMap,
    };
  }

  const v = classify(build, program);
  switch (v.kind) {
    // classify only ever runs on non-template builds, so it can't hand back a
    // template here — but its return type spans the whole verdict union, so we
    // name the case rather than leave the switch open.
    case "template":
      throw new Error(
        "interchange: a non-template build classified as a template",
      );
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
      return { status: "impossible", blockers: v.blockers };
    case "unresolved": {
      // Nothing storable to hand over — but say why off the cliff records, not
      // off how the build routed. Firing-blind, an event-anchored cliff is
      // always unfired and so always lands in this arm; the precise reason (the
      // schema has no home for an event cliff at all) would be lost if we only
      // reported the generic deferred-cliff one.
      const eventCliff = build.resolutions
        .map((r) => r.cliff)
        .find((c) => c.state === "EVENT");
      return eventCliff?.state === "EVENT"
        ? {
            status: "unrepresentable",
            reason: { kind: "EVENT_CLIFF", eventId: eventCliff.eventId },
          }
        : { status: "unrepresentable", reason: { kind: "DEFERRED_CLIFF" } };
    }
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
  ctxInput: EvaluationContextInput,
): InterchangeVerdict => {
  const ctx = createEvaluationContext(ctxInput);
  const totalShares = ctx.grantQuantity;
  // grantDate and vestingStart are their own context fields, so blanking `events`
  // drops only the genuine named firings, not the system anchors a start needs.
  const interchangeCtx = { ...ctx, events: {} };
  const build = buildTemplate(
    resolveStatements(program, interchangeCtx, totalShares),
    interchangeCtx,
    totalShares,
  );
  return mapTemplateBuild(build, program);
};
