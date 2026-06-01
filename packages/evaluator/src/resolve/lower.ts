// Lower a resolved DSL program to a single canonical template.
//
// vestlang evaluates each statement independently, each with its own `FROM`
// start; the canonical template chains DATE statements off one hoisted
// `runtime.startDate` via a cursor. Lowering (1) reuses the selector layer to
// resolve each statement's start/cliff to concrete dates, (2) hoists the first
// DATE anchor to `runtime.startDate` and chains the rest, and (3) lowers the
// cliff to the time-based form. A program that resolves but doesn't fit one
// template (event cliff, non-chaining independent grids) or doesn't resolve is
// reported for the classifier to route to the `events` or `unresolved` arm.

import type {
  Amount,
  Blocker,
  EvaluationContext,
  Program,
  Schedule,
  ScheduleExpr,
  SourceMap,
  VestingNodeExpr,
  OCTDate,
} from "@vestlang/types";
import { stringifyVestingNodeExpr } from "@vestlang/stringify";
import type {
  Cliff,
  Fraction,
  PeriodType,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/types";
import { addPeriod, eq, fracReduce } from "@vestlang/core";
import { evaluateScheduleExpr } from "../evaluate/selectors.js";
import { isPickedResolved } from "../evaluate/utils.js";
import { lowerCliff, type LoweredCliff } from "./cliff.js";
import type { NonTemplateReason } from "./types.js";

const DEFAULT_DAY_OF_MONTH = "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";
const DEFAULT_ALLOCATION = "CUMULATIVE_ROUND_DOWN";

// The normalizer's internal anchors (packages/normalizer .. program.ts SYSTEM_EVENT).
// They always resolve to a concrete date, so a start expressed relative to one
// (e.g. `FROM +12 months` = `grantDate + 12mo`) is an absolute service-time DATE,
// not a floating milestone, so it must not register an event firing.
const SYSTEM_EVENTS = new Set(["grantDate", "vestingStart"]);

/** The two cumulative modes telescope as a single running fraction. The four
 *  loaded modes don't, so they can't compile to one template and route to
 *  events-only instead. */
const isCumulativeAllocation = (mode: string): boolean =>
  mode === "CUMULATIVE_ROUND_DOWN" || mode === "CUMULATIVE_ROUNDING";

/** DSL amount → canonical portion. QUANTITY `v` → `v / totalShares`. */
const amountToFraction = (a: Amount, totalShares: number): Fraction =>
  a.type === "QUANTITY"
    ? fracReduce({ numerator: a.value, denominator: totalShares })
    : fracReduce({ numerator: a.numerator, denominator: a.denominator });

/** First SINGLETON schedule of an expression (descend combinators' items[0]). */
const firstSchedule = (expr: ScheduleExpr): Schedule => {
  let e = expr;
  while (e.type !== "SINGLETON") e = e.items[0];
  return e;
};

/** DATE vs floating EVENT, from the (winning) schedule's vesting_start leaf.
 *  A genuine named event floats; a system anchor (grantDate/vestingStart) is a
 *  resolved absolute date and is treated as DATE (so `FROM +N months` chains and
 *  never registers a duplicate `grantDate` firing). */
const startBase = (
  vs: VestingNodeExpr,
): { base: "DATE" | "EVENT"; eventId?: string } =>
  vs.type === "SINGLETON" &&
  vs.base.type === "EVENT" &&
  !SYSTEM_EVENTS.has(vs.base.value)
    ? { base: "EVENT", eventId: vs.base.value }
    : { base: "DATE" };

/** A start expression that selects an anchor (EARLIER_OF/LATER_OF), not a leaf. */
const isCombinator = (e: VestingNodeExpr): boolean =>
  e.type === "EARLIER_OF" || e.type === "LATER_OF";

/** Does the expression reference ≥1 genuine named EVENT (not a system anchor)?
 *  The synthetic-event admission test: a combinator anchor earns a synthetic
 *  event only if its definition names a real condition. Guards against smuggling
 *  a pure-date combinator (which resolves directly) into the synthetic path. */
const referencesNamedEvent = (e: VestingNodeExpr): boolean =>
  e.type === "SINGLETON"
    ? e.base.type === "EVENT" && !SYSTEM_EVENTS.has(e.base.value)
    : e.items.some(referencesNamedEvent);

export interface StmtResolution {
  percentage: Fraction;
  periodicity: { type: PeriodType; length: number; occurrences: number };
  start:
    | {
        state: "RESOLVED";
        date: OCTDate;
        base: "DATE" | "EVENT";
        eventId?: string;
      }
    // An unfired *atomic* EVENT start: canonical holds it as an EVENT statement
    // with no firing, so it lowers into the template rather than poisoning the
    // program to `unresolved`. The blockers carry the pending-ness.
    | { state: "PENDING_EVENT"; eventId: string; blockers: Blocker[] }
    // A combinator-over-anchors start referencing ≥1 named EVENT: it collapses to
    // one synthetic event, lowering into the template. `expr` is the
    // raw combinator; `buildTemplate` mints its grant-scoped id (with dedup across
    // statements) and records its DSL definition in the source map.
    | { state: "SYNTHETIC_EVENT"; expr: VestingNodeExpr; blockers: Blocker[] }
    | { state: "UNRESOLVED"; blockers: Blocker[] };
  cliff: LoweredCliff;
}

/** Resolve every statement against runtime — the shared input to 4a and 4b. */
export const resolveStatements = (
  program: Program,
  ctx: EvaluationContext,
  totalShares: number,
): StmtResolution[] =>
  program.map((stmt) => {
    const percentage = amountToFraction(stmt.amount, totalShares);
    const res = evaluateScheduleExpr(stmt.expr, ctx);

    if (isPickedResolved(res)) {
      const schedule = res.picked;
      const p = schedule.periodicity;
      const periodicity = {
        type: p.type,
        length: p.length,
        occurrences: p.occurrences,
      };
      return {
        percentage,
        periodicity,
        start: {
          state: "RESOLVED",
          date: res.meta.date,
          ...startBase(schedule.vesting_start),
        },
        cliff: lowerCliff(
          p.cliff,
          res.meta.date,
          p.type,
          p.length,
          p.occurrences,
          ctx,
        ),
      };
    }

    // Start did not fully resolve. Periodicity is best-effort for the
    // unresolved arm: the winning schedule if partially picked, else the first.
    const sched = res.type === "PICKED" ? res.picked : firstSchedule(stmt.expr);
    const p = sched.periodicity;
    const blockers: Blocker[] =
      res.type === "PICKED"
        ? res.meta.type === "UNRESOLVED"
          ? res.meta.blockers
          : []
        : res.blockers;
    const periodicity = {
      type: p.type,
      length: p.length,
      occurrences: p.occurrences,
    };

    // An unfired *atomic* EVENT start (a bare SINGLETON named event, not a
    // combinator or a system anchor) lowers into the template as an EVENT
    // statement with no firing. Requires a non-PICKED UNRESOLVED (rules out
    // IMPOSSIBLE and partially-picked combinators) and no cliff (an event-anchored
    // cliff can't be lowered without the firing date, so keep it UNRESOLVED so it
    // isn't silently dropped).
    const sb = startBase(sched.vesting_start);
    if (res.type === "UNRESOLVED" && sb.base === "EVENT" && !p.cliff) {
      return {
        percentage,
        periodicity,
        start: { state: "PENDING_EVENT", eventId: sb.eventId!, blockers },
        cliff: { state: "NONE" },
      };
    }

    // A combinator-over-anchors start (EARLIER_OF/LATER_OF) that references a
    // named EVENT collapses to one synthetic event. It selects an *anchor*, not a
    // structure, so the fixed downstream grid still lowers into the template with
    // one deferred event. A pure-date combinator (no named event) fails this test
    // and keeps its normal resolution. Cliffs are excluded (an event cliff selects
    // a structure and stays unresolved), as is IMPOSSIBLE (the res.type guards).
    // The pending shape differs by arm: LATER_OF surfaces as PICKED with
    // UNRESOLVED meta; EARLIER_OF and a fully-pending LATER_OF surface as
    // UNRESOLVED.
    const vs = sched.vesting_start;
    if (
      (res.type === "UNRESOLVED" ||
        (res.type === "PICKED" && res.meta.type === "UNRESOLVED")) &&
      isCombinator(vs) &&
      referencesNamedEvent(vs) &&
      !p.cliff
    ) {
      return {
        percentage,
        periodicity,
        start: { state: "SYNTHETIC_EVENT", expr: vs, blockers },
        cliff: { state: "NONE" },
      };
    }

    return {
      percentage,
      periodicity,
      start: { state: "UNRESOLVED", blockers },
      cliff: { state: "NONE" },
    };
  });

export type TemplateBuild =
  | {
      ok: true;
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      totalShares: number;
      // Externalized combinator gates: `event_id → { definition }` for each
      // synthetic event minted below. Empty unless a combinator-over-anchors
      // start was collapsed.
      sourceMap: SourceMap;
      // Pending-ness under a `template` verdict: the unfired atomic EVENT starts
      // and unresolved synthetic-event combinators whose witnesses haven't
      // arrived. Advisory — the program is still a valid template; these say
      // which projections are still empty.
      blockers: Blocker[];
    }
  | {
      ok: false;
      why: "unresolved";
      resolutions: StmtResolution[];
      ctx: EvaluationContext;
      totalShares: number;
    }
  | {
      ok: false;
      why: "events";
      reason: NonTemplateReason;
      resolutions: StmtResolution[];
      ctx: EvaluationContext;
      totalShares: number;
    };

/**
 * Assemble one canonical template from the per-statement resolutions, or report
 * why it can't be one: any unresolved start/cliff → `unresolved`; an event cliff
 * or non-chaining independent DATE grids → `events`.
 */
export const buildTemplate = (
  resolutions: StmtResolution[],
  ctx: EvaluationContext,
  totalShares: number,
): TemplateBuild => {
  const unresolved = (): TemplateBuild => ({
    ok: false,
    why: "unresolved",
    resolutions,
    ctx,
    totalShares,
  });
  const events = (reason: NonTemplateReason): TemplateBuild => ({
    ok: false,
    why: "events",
    reason,
    resolutions,
    ctx,
    totalShares,
  });

  // Only a genuinely-unresolved start poisons the program. An unfired atomic
  // EVENT start (PENDING_EVENT) lowers into the template.
  if (resolutions.some((r) => r.start.state === "UNRESOLVED"))
    return unresolved();
  if (resolutions.some((r) => r.cliff.state === "UNRESOLVED"))
    return unresolved();
  // Loaded (non-cumulative) allocation isn't a single cumulative across the
  // template, and the interchange has no allocation field, so route to
  // events-only.
  if (!isCumulativeAllocation(ctx.allocation_type)) {
    return events({ kind: "LOADED_ALLOCATION", mode: ctx.allocation_type });
  }
  const eventCliff = resolutions.find((r) => r.cliff.state === "EVENT");
  if (eventCliff && eventCliff.cliff.state === "EVENT") {
    return events({ kind: "EVENT_CLIFF", eventId: eventCliff.cliff.eventId });
  }

  const dom = ctx.vesting_day_of_month;
  const statements: VestingStatement[] = [];
  const eventFirings: NonNullable<VestingRuntime["eventFirings"]> = [];
  const blockers: Blocker[] = [];
  // Synthetic events: minted once per distinct gate (keyed by its DSL
  // definition), so two portions on the byte-identical anchor share one id and
  // one source-map entry.
  const sourceMap: SourceMap = {};
  const synthByDef = new Map<string, string>();
  let synthOrdinal = 0;
  // Core dates are plain ISO strings (OCTDate); addPeriod returns the same.
  let startDate: string | undefined;
  let cursor: string | undefined;

  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    const { type, length, occurrences } = r.periodicity;

    let vesting_base: VestingStatement["vesting_base"];
    if (r.start.state === "PENDING_EVENT") {
      // Unfired atomic EVENT: an EVENT statement with no firing. The projection
      // stays empty until the witness arrives; the blocker carries the
      // pending-ness onto the `template` verdict.
      vesting_base = { type: "EVENT", event_id: r.start.eventId };
      blockers.push(...r.start.blockers);
    } else if (r.start.state === "SYNTHETIC_EVENT") {
      // Combinator-over-anchors: externalize the gate as one synthetic event.
      // The definition (its DSL) is the dedup key — same anchor → same id, one
      // source-map entry. No firing yet; the witness is computed by re-resolving
      // the definition at rehydration.
      const definition = stringifyVestingNodeExpr(r.start.expr);
      let eventId = synthByDef.get(definition);
      if (eventId === undefined) {
        eventId = `evt_${++synthOrdinal}`;
        synthByDef.set(definition, eventId);
        sourceMap[eventId] = { definition };
      }
      vesting_base = { type: "EVENT", event_id: eventId };
      blockers.push(...r.start.blockers);
    } else if (r.start.state === "UNRESOLVED") {
      return unresolved(); // narrowing; unreachable after the guard above
    } else if (r.start.base === "EVENT") {
      const eventId = r.start.eventId!;
      const firingDate = r.start.date;
      vesting_base = { type: "EVENT", event_id: eventId };
      // One firing per event_id: multiple portions may float to the same event.
      // The same event firing twice at different dates can't be one template.
      const existing = eventFirings.find((f) => f.event_id === eventId);
      if (!existing) {
        eventFirings.push({ event_id: eventId, date: firingDate });
      } else if (!eq(existing.date, firingDate)) {
        return events({
          kind: "OVERLAPPING_ABSOLUTE_STARTS",
          detail: `Event "${eventId}" anchors two portions at different dates, which has no single template form.`,
        });
      }
    } else {
      vesting_base = { type: "DATE" };
      if (cursor === undefined) {
        startDate = r.start.date;
      } else if (!eq(r.start.date, cursor)) {
        // A second independent DATE grid that doesn't chain — not one template.
        return events({ kind: "OVERLAPPING_ABSOLUTE_STARTS" });
      }
      cursor = addPeriod(r.start.date, occurrences * length, type, dom);
    }

    const cliff: Cliff | undefined =
      r.cliff.state === "RESOLVED" ? r.cliff.cliff : undefined;

    statements.push({
      order: i + 1,
      vesting_base,
      occurrences,
      period: length,
      period_type: type,
      percentage: r.percentage,
      ...(cliff ? { cliff } : {}),
    });
  }

  const runtime: VestingRuntime = {
    ...(startDate !== undefined ? { startDate } : {}),
    ...(eventFirings.length > 0 ? { eventFirings } : {}),
    // Grant-date implicit cliff: amounts scheduled before the grant existed fold
    // onto grantDate. Core's compile applies this when runtime.grantDate is set.
    ...(ctx.events.grantDate ? { grantDate: ctx.events.grantDate } : {}),
    ...(ctx.vesting_day_of_month !== DEFAULT_DAY_OF_MONTH
      ? { vestingDayOfMonth: ctx.vesting_day_of_month }
      : {}),
    ...(ctx.allocation_type !== DEFAULT_ALLOCATION
      ? { allocationType: ctx.allocation_type }
      : {}),
  };

  return {
    ok: true,
    template: { id: "resolved", statements },
    runtime,
    totalShares,
    sourceMap,
    blockers,
  };
};
