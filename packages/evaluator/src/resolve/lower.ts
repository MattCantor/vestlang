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
  Statement,
  VestingNodeExpr,
  OCTDate,
} from "@vestlang/types";
import { stringifyVestingNodeExpr } from "@vestlang/render";
import type {
  Cliff,
  Fraction,
  PeriodType,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/types";
import { advanceCursor, eq, fracReduce } from "@vestlang/core";
import { evaluateScheduleExpr } from "../evaluate/selectors.js";
import { isPickedResolved } from "../evaluate/utils.js";
import { lowerCliff, lowerDeferredCliff, type LoweredCliff } from "./cliff.js";
import type { NonTemplateReason } from "./types.js";

const DEFAULT_DAY_OF_MONTH = "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";

// The normalizer's internal anchors (packages/normalizer .. program.ts SYSTEM_EVENT).
// They always resolve to a concrete date, so a start expressed relative to one
// (e.g. `FROM +12 months` = `grantDate + 12mo`) is an absolute service-time DATE,
// not a floating milestone, so it must not register an event firing.
const SYSTEM_EVENTS = new Set(["grantDate", "vestingStart"]);

/** DSL amount → canonical portion. QUANTITY `v` → `v / totalShares`. */
const amountToFraction = (a: Amount, totalShares: number): Fraction =>
  a.type === "QUANTITY"
    ? fracReduce({ numerator: a.value, denominator: totalShares })
    : fracReduce({ numerator: a.numerator, denominator: a.denominator });

/** First single schedule of an expression (descend combinators' items[0]). */
const firstSchedule = (expr: ScheduleExpr): Schedule => {
  let e = expr;
  while (e.type !== "SCHEDULE") e = e.items[0];
  return e;
};

/** DATE vs floating EVENT, from the (winning) schedule's vesting_start leaf.
 *  A genuine named event floats; a system anchor (grantDate/vestingStart) is a
 *  resolved absolute date and is treated as DATE (so `FROM +N months` chains and
 *  never registers a duplicate `grantDate` firing). */
const startBase = (
  vs: VestingNodeExpr,
): { base: "DATE" | "EVENT"; eventId?: string } =>
  vs.type === "NODE" &&
  vs.base.type === "EVENT" &&
  !SYSTEM_EVENTS.has(vs.base.value)
    ? { base: "EVENT", eventId: vs.base.value }
    : { base: "DATE" };

/** A start expression that selects an anchor (EARLIER OF / LATER OF), not a leaf. */
const isCombinator = (e: VestingNodeExpr): boolean =>
  e.type === "NODE_EARLIER_OF" || e.type === "NODE_LATER_OF";

/** Does the expression reference ≥1 genuine named EVENT (not a system anchor)?
 *  The synthetic-event admission test: a combinator anchor earns a synthetic
 *  event only if its definition names a real condition. Guards against smuggling
 *  a pure-date combinator (which resolves directly) into the synthetic path.
 *
 *  This reads like a job for `@vestlang/walk`'s `some` (recover uses it for a
 *  near-identical "is there an event in here?" check), but it isn't one. It only
 *  walks the anchor itself: the node's own base, and the arms of an EARLIER/LATER
 *  OF. It deliberately does NOT look inside a node's BEFORE/AFTER condition. A
 *  shared `some` descends every edge, so it would also count an event gated in a
 *  constraint — widening what qualifies as a referenced event and changing which
 *  starts get a synthetic event. That's a semantic call about the start anchor,
 *  not a generic tree walk, so the recursion stays here and stays narrow. */
const referencesNamedEvent = (e: VestingNodeExpr): boolean =>
  e.type === "NODE"
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
  // True for a THEN tail (a segment that continues the previous one). The
  // start above was injected by the chaining walk rather than read off the
  // statement's own FROM, and buildTemplate uses this to word the right error
  // when an event-anchored chain can't become a single template.
  chained?: boolean;
  // The date the chain this segment belongs to started from, set only on tails.
  // A tail's own `start` is a clamped handoff (Feb 28 from a Jan 31 head); the
  // origin keeps the chain's first day-of-month (the 31st) around so the dates
  // can spring back when materialized. Absent on a non-tail, where the segment is
  // its own origin and consumers fall back to `start.date`.
  origin?: OCTDate;
}

/** Resolve one ordinary (non-chained) statement: its start comes from its own
 *  `FROM` expression, resolved through the normal selector path. This is the body
 *  that used to be the whole of `resolveStatements`; the chaining walk below now
 *  calls it for every statement that isn't a THEN tail. */
const resolveNonChained = (
  stmt: Extract<Statement, { chained?: false }>,
  ctx: EvaluationContext,
  totalShares: number,
): StmtResolution => {
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

  // An unfired *atomic* EVENT start (a bare single node naming an event, not a
  // combinator or a system anchor) lowers into the template as an EVENT
  // statement with no firing. Requires a non-PICKED UNRESOLVED (rules out
  // IMPOSSIBLE and partially-picked combinators). A `vestingStart`-relative
  // duration cliff lowers anchor-free and rides along on the pending statement;
  // a cliff that genuinely needs the firing date (event cliff, cross-unit) keeps
  // the whole statement UNRESOLVED so it isn't silently dropped.
  const sb = startBase(sched.vesting_start);
  if (res.type === "UNRESOLVED" && sb.base === "EVENT") {
    const cliff = lowerDeferredCliff(p.cliff, p.type, p.length, p.occurrences);
    if (cliff.state === "NONE" || cliff.state === "RESOLVED") {
      return {
        percentage,
        periodicity,
        start: { state: "PENDING_EVENT", eventId: sb.eventId!, blockers },
        cliff,
      };
    }
  }

  // A combinator-over-anchors start (EARLIER_OF/LATER_OF) that references a
  // named EVENT collapses to one synthetic event. It selects an *anchor*, not a
  // structure, so the fixed downstream grid still lowers into the template with
  // one deferred event. A pure-date combinator (no named event) fails this test
  // and keeps its normal resolution. IMPOSSIBLE is excluded by the res.type
  // guards. As on the atomic path, a `vestingStart`-relative duration cliff
  // lowers anchor-free and rides along; a cliff that needs the firing date keeps
  // the statement UNRESOLVED. The pending shape differs by arm: LATER_OF
  // surfaces as PICKED with UNRESOLVED meta; EARLIER_OF and a fully-pending
  // LATER_OF surface as UNRESOLVED.
  const vs = sched.vesting_start;
  if (
    (res.type === "UNRESOLVED" ||
      (res.type === "PICKED" && res.meta.type === "UNRESOLVED")) &&
    isCombinator(vs) &&
    referencesNamedEvent(vs)
  ) {
    const cliff = lowerDeferredCliff(p.cliff, p.type, p.length, p.occurrences);
    if (cliff.state === "NONE" || cliff.state === "RESOLVED") {
      return {
        percentage,
        periodicity,
        start: { state: "SYNTHETIC_EVENT", expr: vs, blockers },
        cliff,
      };
    }
  }

  return {
    percentage,
    periodicity,
    start: { state: "UNRESOLVED", blockers },
    cliff: { state: "NONE" },
  };
};

// How the next THEN tail should begin. The chaining walk recomputes this after
// every statement and hands it to the following tail.
// `origin` on the live variants is the date the whole chain started from — the
// head's start for a date chain, or the firing date for a fired-event chain. Every
// segment takes its day-of-month from the origin, not from `cursor`. That matters
// at a month boundary: stepping Jan 31 forward a month clamps to Feb 28 (February
// has no 31st), and if the next segment read its day off that clamped cursor it
// would stay on the 28th for the rest of the chain. Carrying the origin lets it
// spring back to the 31st (or the month's last day) the way an un-split schedule
// would. See packages/core/src/dates.ts for the matching stepper parameter.
type ChainAnchor =
  // A live date chain: the tail starts on `cursor` as a plain DATE.
  | { kind: "DATE"; cursor: OCTDate; origin: OCTDate }
  // A chain whose head is an event that has already fired. The tail still steps
  // forward by calendar math (off `cursor`), but it stays anchored to the same
  // event so the firing guard in buildTemplate recognizes the whole run as one
  // event-origin chain rather than a date template.
  | { kind: "EVENT"; eventId: string; cursor: OCTDate; origin: OCTDate }
  // A chain whose head is an event with no date yet (unfired atomic event, or a
  // selector still waiting on one). There's nothing to hand the tail, so the
  // tail can't vest until the event arrives. We carry the head's blockers so the
  // tail can report what it's waiting on.
  | { kind: "PENDING"; blockers: Blocker[] }
  // No chain in progress: we're at the first statement, or a prior statement
  // didn't resolve to anything a tail could continue from.
  | undefined;

/** The anchor a following THEN tail inherits from the statement just resolved. */
const anchorAfter = (
  r: StmtResolution,
  dom: EvaluationContext["vesting_day_of_month"],
): ChainAnchor => {
  const { occurrences, length, type } = r.periodicity;
  if (r.start.state === "RESOLVED") {
    // This statement heads the chain, so it is its own origin. Passing its start
    // as the origin makes this first handoff identical to the old call (origin
    // defaults to the date being stepped from); the origin only changes later
    // handoffs, once the cursor has been clamped onto a short month.
    const cursor = advanceCursor(
      r.start.date,
      occurrences,
      length,
      type,
      dom,
      r.start.date,
    );
    return r.start.base === "EVENT"
      ? {
          kind: "EVENT",
          eventId: r.start.eventId!,
          cursor,
          origin: r.start.date,
        }
      : { kind: "DATE", cursor, origin: r.start.date };
  }
  // PENDING_EVENT / SYNTHETIC_EVENT / UNRESOLVED: the start has no date, so any
  // tail behind it is pending on whatever the head is waiting on.
  return { kind: "PENDING", blockers: r.start.blockers };
};

/**
 * Resolve every statement against runtime — the shared input to 4a and 4b.
 *
 * Statements joined by THEN form a "chain": each tail picks up the timeline
 * exactly where the previous segment ended, so the author never hand-writes the
 * handoff dates. We walk the program left to right carrying a `ChainAnchor` that
 * describes where the next tail starts, and hand each tail that start. Cursor
 * dates are advanced with core's own `advanceCursor`, so a chain's dates match
 * what the canonical compiler would produce, to the day.
 *
 * A chain headed on a fired event resolves its tails to concrete dates but keeps
 * them anchored to that event; head and tails then read as the same event firing
 * at different dates, which can't be one template, so it routes to events-only.
 * A chain headed on an unfired event has no dates to hand out, so its tails stay
 * unresolved until the event arrives.
 */
export const resolveStatements = (
  program: Program,
  ctx: EvaluationContext,
  totalShares: number,
): StmtResolution[] => {
  const dom = ctx.vesting_day_of_month;
  const out: StmtResolution[] = [];
  let anchor: ChainAnchor;

  for (const stmt of program) {
    if (stmt.chained) {
      // The grammar only ever emits a tail after a head or another tail, so a
      // tail with no anchor is an internal bug, not a malformed program.
      if (anchor === undefined) {
        throw new Error(
          "a chained THEN tail has no preceding statement to continue from; the chaining walk reached a tail with no live anchor.",
        );
      }
      const p = stmt.expr.periodicity;
      const periodicity = {
        type: p.type,
        length: p.length,
        occurrences: p.occurrences,
      };
      const percentage = amountToFraction(stmt.amount, totalShares);

      if (anchor.kind === "PENDING") {
        // The head's event hasn't fired, so there's no handoff date. The tail is
        // unresolved on that event; later tails in the same chain stay pending
        // too, so we leave the anchor untouched.
        out.push({
          percentage,
          periodicity,
          start: { state: "UNRESOLVED", blockers: anchor.blockers },
          cliff: { state: "NONE" },
          chained: true,
        });
        continue;
      }

      const date = anchor.cursor;
      out.push({
        percentage,
        periodicity,
        // The handoff date is this tail's start. A cliff on the tail therefore
        // measures from the handoff, exactly as a head cliff measures from the
        // head's start, with no special casing. An event-origin tail keeps the
        // head's event id so buildTemplate can tell the chain apart from two
        // independent portions that happen to share an event.
        start:
          anchor.kind === "EVENT"
            ? {
                state: "RESOLVED",
                date,
                base: "EVENT",
                eventId: anchor.eventId,
              }
            : { state: "RESOLVED", date, base: "DATE" },
        // Pass the chain origin so a sub-annual cliff counts its pre-cliff
        // tranches on the same sprung grid this tail vests on, rather than on
        // the clamped handoff day.
        cliff: lowerCliff(
          p.cliff,
          date,
          p.type,
          p.length,
          p.occurrences,
          ctx,
          anchor.origin,
        ),
        chained: true,
        // The chain's starting date, not this tail's clamped handoff. Carried so
        // a later materialization can re-derive the original day-of-month.
        origin: anchor.origin,
      });
      anchor = {
        ...anchor,
        // Step the next handoff off the chain origin's day-of-month, so a boundary
        // that clamped onto a short month doesn't strand the rest of the chain on
        // the clamped day. The `...anchor` spread keeps `origin` for later tails.
        cursor: advanceCursor(
          date,
          p.occurrences,
          p.length,
          p.type,
          dom,
          anchor.origin,
        ),
      };
      continue;
    }

    const resolution = resolveNonChained(stmt, ctx, totalShares);
    out.push(resolution);
    // A non-chained statement begins a fresh component, so the chain restarts
    // from this statement rather than continuing the previous one.
    anchor = anchorAfter(resolution, dom);
  }

  return out;
};

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
  // Core dates are plain ISO strings (OCTDate); advanceCursor returns the same.
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
        // A chained tail produces this collision by design: a THEN chain off an
        // event walks its segments forward from the event's firing, so the head
        // and each tail land on the same event at different dates. That's a valid
        // sequence, just not a single date template, so it falls to events-only
        // (and would become a template if event chaining is ever supported).
        // Without the chain, this is a genuine clash: two independent portions
        // both floating to one event but wanting it on different days.
        return events({
          kind: "OVERLAPPING_ABSOLUTE_STARTS",
          detail: r.chained
            ? `An event-origin THEN chain anchored on "${eventId}" sequences its segments to different dates, which is not a single template; it classifies to events-only and would promote to a template if event chaining is later supported.`
            : `Event "${eventId}" anchors two portions at different dates, which has no single template form.`,
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
      // The continuation check above compares each statement's start against this
      // cursor, so the cursor must step exactly the way the resolve pre-pass did.
      // Both feed `advanceCursor` the chain origin (the first DATE start). If only
      // one did, a month-end handoff would produce Mar 31 on one side and Mar 28
      // on the other, the eq check would miss, and a valid chain would wrongly
      // split off to events-only. On the first DATE statement startDate is this
      // start, so the two are equal.
      cursor = advanceCursor(
        r.start.date,
        occurrences,
        length,
        type,
        dom,
        startDate ?? r.start.date,
      );
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
