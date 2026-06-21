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
  Blocker,
  ResolutionContext,
  ImpossibleBlocker,
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
  PeriodTag,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { advanceCursor, eq } from "@vestlang/core";
import { eventBaseId, isGatedNode, referencesEvent } from "@vestlang/walk";
import { evaluateScheduleExpr } from "../evaluate/selectors.js";
import { amountToFraction } from "../claims.js";
import { isPickedCommitted, isPickedResolved } from "../evaluate/utils.js";
import { lowerCliff, lowerDeferredCliff, type LoweredCliff } from "./cliff.js";
import { syntheticEventId } from "./synthetic.js";
import type { NonTemplateReason } from "@vestlang/types";

/** First single schedule of an expression (descend combinators' items[0]). */
const firstSchedule = (expr: ScheduleExpr): Schedule => {
  let e = expr;
  while (e.type !== "SCHEDULE") e = e.items[0];
  return e;
};

/** DATE vs floating EVENT, from the (winning) schedule's vesting_start leaf.
 *  A genuine named event (`base.type === "EVENT"`) floats; the start slot's system
 *  anchor is GRANT_DATE (VESTING_START is excluded by the slot's type) — a resolved
 *  absolute date — and falls to DATE, so `FROM +N months` chains and never
 *  registers a spurious event firing. The tag is the distinction; no value test
 *  needed. */
const startBase = (
  vs: VestingNodeExpr<"GRANT_DATE">,
): { type: "DATE" } | { type: "EVENT"; eventId: string } => {
  const eventId = eventBaseId(vs);
  return eventId !== undefined ? { type: "EVENT", eventId } : { type: "DATE" };
};

/** A start expression that selects an anchor (EARLIER OF / LATER OF), not a leaf. */
const isCombinator = (e: VestingNodeExpr): boolean =>
  e.type === "NODE_EARLIER_OF" || e.type === "NODE_LATER_OF";

/** Non-empty offsets on a leaf node — one of the things a bare EVENT base in the
 *  template can't hold. (`eventBaseId` reads through offsets on purpose, so the
 *  check is the caller's.) */
const hasOffsets = (e: VestingNodeExpr): boolean =>
  e.type === "NODE" && e.offsets.length > 0;

export interface StmtResolution {
  percentage: Fraction;
  // Mirrors the normalized cadence (`VestingPeriod`), so the unit is always a
  // PeriodTag (DAYS/MONTHS — YEARS is desugared upstream); a cliff's own
  // period_type can still widen to DAYS independently.
  periodicity: { type: PeriodTag; length: number; occurrences: number };
  start:
    | {
        state: "RESOLVED";
        date: OCTDate;
        base: { type: "DATE" } | { type: "EVENT"; eventId: string };
        // Set when an EVENT base carries offsets (`FROM EVENT ipo + 1 month`,
        // fired): the full anchor expression. A bare EVENT statement can't hold
        // the offset — storing `eventId` with `date` as its firing would assert
        // the event fired a month after it actually did — so buildTemplate
        // externalizes this as a synthetic event whose definition keeps the
        // offset and whose recorded firing is `date`, true by that definition.
        offsetExpr?: VestingNodeExpr;
      }
    // An EARLIER_OF start that committed to its resolved floor (resolution mode).
    // Structurally a RESOLVED start — the winning arm's `base` lowers exactly the
    // same way (DATE hoist/cursor or fired EVENT) — plus the required
    // `disclosures`: the still-pending siblings' blockers, stamped `through` the
    // committed date, which buildTemplate pushes onto `build.blockers` so they
    // reach `absenceAssumptions` and `resolution.pending`. Kept distinct from
    // RESOLVED so the disclosures can't be silently dropped.
    | {
        state: "COMMITTED";
        date: OCTDate;
        base: { type: "DATE" } | { type: "EVENT"; eventId: string };
        offsetExpr?: VestingNodeExpr;
        disclosures: Blocker[];
      }
    // An unfired *bare* EVENT start — atomic, ungated, offset-free: canonical
    // holds it as an EVENT statement with no firing, so it lowers into the
    // template rather than poisoning the program to `unresolved`. The blockers
    // carry the pending-ness.
    | { state: "PENDING_EVENT"; eventId: string; blockers: Blocker[] }
    // A pending start that references a named EVENT and carries structure a bare
    // EVENT base can't hold — a combinator over anchors, a BEFORE/AFTER gate, or
    // offsets on the anchor. It collapses to one synthetic event, lowering into
    // the template. `expr` is the raw start expression; `buildTemplate` mints its
    // grant-scoped id (with dedup across statements) and records its DSL
    // definition in the source map.
    //
    // `partial` is true when a branch of the combinator already settled to a date
    // (a LATER OF whose later arm we know) — the cadence is then placeable as
    // symbolic `start + N` tranches even though the anchor itself is pending. When
    // nothing has settled (no arm resolved, or a gated atomic event), it's false
    // and the whole portion is one undated lump. Only the projection reads it.
    | {
        state: "SYNTHETIC_EVENT";
        expr: VestingNodeExpr;
        blockers: Blocker[];
        partial: boolean;
      }
    | { state: "UNRESOLVED"; blockers: Blocker[] }
    // A contradictory start. Today a dead start flattens to UNRESOLVED, which is
    // why the projection has to re-resolve to recover the contradiction; carrying
    // it lets buildTemplate poison the program directly off the record.
    | { state: "IMPOSSIBLE"; blockers: ImpossibleBlocker[] };
  cliff: LoweredCliff;
  // Where this segment sits in a THEN chain. A `head` is a fresh component (a
  // statement with its own FROM). A tail's start was injected by the chaining
  // walk rather than read off its own FROM: when the handoff produced a date the
  // tail is a `tail` and carries the chain's `origin`; when the head is still
  // waiting on an event there's no date to hand off and the tail is a
  // `pending-tail`. buildTemplate keys on the role to word the right error when
  // an event-anchored chain can't become a single template, and the projection
  // reads `origin` to grid the tail on the grant's vesting day.
  //
  // The `origin` is the date the whole chain started from. A tail's own `start`
  // is wherever the previous segment handed off (Feb 28 off a Jan 31 head, or
  // mid-month off a DAYS run); the origin keeps the chain's first day-of-month
  // (the 31st) so every tail grids on the grant's one vesting day rather than on
  // the handoff. A head is its own origin, so consumers fall back to `start.date`
  // there. It lives only on the `tail` arm, where a date is known: a head has no
  // chain to date from, and a pending-tail never produced one.
  chain:
    | { role: "head" }
    | { role: "tail"; origin: OCTDate }
    | { role: "pending-tail" };
}

// The disclosures a start hands to the blocker set: a committed EARLIER_OF floor's
// still-pending siblings, nothing otherwise. One read shared by the three
// blocker-gathering arms, so they can't drift on what a COMMITTED start owes.
export const disclosuresOf = (start: StmtResolution["start"]): Blocker[] =>
  start.state === "COMMITTED" ? start.disclosures : [];

/** Resolve one ordinary (non-chained) statement: its start comes from its own
 *  `FROM` expression, resolved through the normal selector path. This is the body
 *  that used to be the whole of `resolveStatements`; the chaining walk below now
 *  calls it for every statement that isn't a THEN tail. */
const resolveNonChained = (
  stmt: Extract<Statement, { chained?: false }>,
  ctx: ResolutionContext,
): StmtResolution => {
  const percentage = amountToFraction(stmt.amount, ctx.grantQuantity);
  const res = evaluateScheduleExpr(stmt.expr, ctx);

  // A resolved OR committed start both settle to a concrete date and lower the
  // same way — the only difference is that a committed EARLIER_OF carries the
  // still-pending siblings' disclosures, which ride onto the start record so
  // buildTemplate can push them onto `build.blockers`.
  if (isPickedResolved(res) || isPickedCommitted(res)) {
    const schedule = res.picked;
    const p = schedule.periodicity;
    const periodicity = {
      type: p.type,
      length: p.length,
      occurrences: p.occurrences,
    };
    const sb = startBase(schedule.vesting_start);
    const date = res.meta.date;
    // A fired event anchor with offsets resolved to firing+offset; keep the
    // expression so buildTemplate externalizes it rather than recording a firing
    // date the event never fired at.
    const offsetExpr =
      sb.type === "EVENT" && hasOffsets(schedule.vesting_start)
        ? { offsetExpr: schedule.vesting_start }
        : {};
    return {
      percentage,
      periodicity,
      start: isPickedCommitted(res)
        ? {
            state: "COMMITTED",
            date,
            base: sb,
            ...offsetExpr,
            disclosures: res.meta.disclosures,
          }
        : { state: "RESOLVED", date, base: sb, ...offsetExpr },
      cliff: lowerCliff(p.cliff, date, p.type, p.length, p.occurrences, ctx),
      chain: { role: "head" },
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

  const vs = sched.vesting_start;
  const sb = startBase(vs);
  // The start didn't resolve to a date but isn't dead either. Two ways it can
  // still lower into the template rather than poisoning the program: as a
  // synthetic event (it names an event and carries structure we must preserve),
  // or as a bare floating EVENT (a plain named event the record keeper owns).
  // Both surface as a non-PICKED UNRESOLVED; a partially-picked LATER_OF surfaces
  // as PICKED with UNRESOLVED meta. Either way, IMPOSSIBLE is excluded — a dead
  // start falls through to the IMPOSSIBLE/UNRESOLVED return below.
  const pending =
    res.type === "UNRESOLVED" ||
    (res.type === "PICKED" && res.meta.type === "UNRESOLVED");

  // Lower the cliff once and carry it on the record whatever the start turns out
  // to be. A pending start has no anchor, so its cliff lowers on the deferred
  // path; carrying it (rather than dropping it as NONE) keeps a cliff's own
  // BEFORE/AFTER gate on the record so it can be disclosed even while the start
  // is unfired. When the cliff itself doesn't resolve, buildTemplate's cliff
  // guard still routes the program to `unresolved`, exactly as the old start
  // guard did — the verdict is unchanged, only the carried detail is richer.
  const cliff = lowerDeferredCliff(
    p.cliff,
    p.type,
    p.length,
    p.occurrences,
    ctx,
  );

  // Externalize as ONE synthetic event whenever the start references a named
  // event AND carries something a bare EVENT base can't hold: a combinator over
  // anchors (EARLIER_OF/LATER_OF), a BEFORE/AFTER gate, or offsets on the anchor
  // (`FROM EVENT ipo + 1 month` — a bare EVENT statement would anchor the grid
  // at the raw firing, a month early). `buildTemplate` stringifies the whole
  // `expr` into the source map, so the structure rides across the storage
  // boundary — a gated start stores its definition, never a guard-stripped event
  // (#18), the same gate reads the same in either word order, `EVENT a BEFORE
  // DATE x` or `DATE x BEFORE EVENT a` (#54), and an offset anchor stores the
  // offset so a replay against the true firing derives the same dates.
  if (
    pending &&
    (isCombinator(vs) || isGatedNode(vs) || hasOffsets(vs)) &&
    referencesEvent(vs)
  ) {
    return {
      percentage,
      periodicity,
      // `partial` is true exactly when a branch already settled (PICKED with
      // pending siblings) — the projection then lays the cadence as start+N
      // tranches rather than one lump.
      start: {
        state: "SYNTHETIC_EVENT",
        expr: vs,
        blockers,
        partial: res.type === "PICKED",
      },
      cliff,
      chain: { role: "head" },
    };
  }

  // A bare atomic EVENT start — a plain named event, no guard, no offsets. It's
  // a real event the record keeper fires directly, so it lowers as an EVENT
  // statement with no firing (no synthetic indirection, no source-map entry).
  // Gated or offset event-base nodes were already claimed by the synthetic
  // branch above.
  if (res.type === "UNRESOLVED" && sb.type === "EVENT") {
    return {
      percentage,
      periodicity,
      start: { state: "PENDING_EVENT", eventId: sb.eventId, blockers },
      cliff,
      chain: { role: "head" },
    };
  }

  // Everything left over: a contradictory start poisons the program (IMPOSSIBLE,
  // carried so the projection can emit the dead installments off the record); any
  // other non-resolving start is plain UNRESOLVED. Both still carry the cliff.
  return {
    percentage,
    periodicity,
    start:
      res.type === "IMPOSSIBLE"
        ? { state: "IMPOSSIBLE", blockers: res.blockers }
        : { state: "UNRESOLVED", blockers },
    cliff,
    chain: { role: "head" },
  };
};

// How the next THEN tail should begin. The chaining walk recomputes this after
// every statement and hands it to the following tail.
// `origin` on the live variants is the date the whole chain started from — the
// head's start for a date chain, or the firing date for a fired-event chain. The
// policy: a grant has one vesting day, the origin's, and every segment takes its
// day-of-month from the origin rather than from `cursor`. The cursor is just
// wherever the previous segment ended, which need not be the vesting day — a DAYS
// run can leave it mid-month (Jan 31 + 27d → Feb 27), and a MONTHS step can clamp
// it onto a short month (Feb has no 31st). Reading the day off the origin keeps
// the whole chain on the grant's day instead of inheriting that accident. See
// packages/core/src/dates.ts for the matching stepper parameter.
type ChainAnchor =
  // A live date chain: the tail starts on `cursor` as a plain DATE.
  | { kind: "DATE"; cursor: OCTDate; origin: OCTDate }
  // A chain whose head is an event that has already fired. The tail still steps
  // forward by calendar math (off `cursor`), but it stays anchored to the same
  // event so the firing guard in buildTemplate recognizes the whole run as one
  // event-origin chain rather than a date template. `offsetExpr` rides along
  // from an offset head for the same reason: the tail then collides on the
  // synthetic identity instead of minting a bare-event firing the head's
  // externalization no longer backs.
  | {
      kind: "EVENT";
      eventId: string;
      offsetExpr?: VestingNodeExpr;
      cursor: OCTDate;
      origin: OCTDate;
    }
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
  dom: ResolutionContext["vesting_day_of_month"],
): ChainAnchor => {
  const { occurrences, length, type } = r.periodicity;
  // A committed start is a concrete date too, so a chain hands off from it exactly
  // as from a RESOLVED one.
  if (r.start.state === "RESOLVED" || r.start.state === "COMMITTED") {
    // This statement heads the chain, so it is its own origin. Passing its start
    // as the origin makes this first handoff a step from the vesting day onto
    // itself (no effect); the origin only bites on later handoffs, once the cursor
    // has drifted off the vesting day or clamped onto a short month.
    const cursor = advanceCursor(
      r.start.date,
      occurrences,
      length,
      type,
      dom,
      r.start.date,
    );
    return r.start.base.type === "EVENT"
      ? {
          kind: "EVENT",
          eventId: r.start.base.eventId,
          ...(r.start.offsetExpr ? { offsetExpr: r.start.offsetExpr } : {}),
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
  ctx: ResolutionContext,
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
      const percentage = amountToFraction(stmt.amount, ctx.grantQuantity);

      if (anchor.kind === "PENDING") {
        // The head's event hasn't fired, so there's no handoff date. The tail is
        // unresolved on that event; later tails in the same chain stay pending
        // too, so we leave the anchor untouched. The tail's authored cliff still
        // lowers — on the deferred path, since there's no anchor to measure from —
        // exactly as a non-chained pending start's does: an event cliff keeps its
        // EVENT identity for the storable-reason scan, and a gated cliff keeps its
        // gate's blockers on the record for disclosure.
        out.push({
          percentage,
          periodicity,
          start: { state: "UNRESOLVED", blockers: anchor.blockers },
          cliff: lowerDeferredCliff(
            p.cliff,
            p.type,
            p.length,
            p.occurrences,
            ctx,
          ),
          chain: { role: "pending-tail" },
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
                base: { type: "EVENT", eventId: anchor.eventId },
                ...(anchor.offsetExpr ? { offsetExpr: anchor.offsetExpr } : {}),
              }
            : { state: "RESOLVED", date, base: { type: "DATE" } },
        // Pass the chain origin so a sub-annual cliff counts its pre-cliff
        // tranches on the same grid this tail vests on — the grant's vesting day
        // — rather than on the handoff day the previous segment happened to end on.
        cliff: lowerCliff(
          p.cliff,
          date,
          p.type,
          p.length,
          p.occurrences,
          ctx,
          anchor.origin,
        ),
        // A dated tail: the handoff produced a date, and `origin` is the chain's
        // starting date (not this tail's handoff) so a later materialization
        // grids the tail on the grant's vesting day.
        chain: { role: "tail", origin: anchor.origin },
      });
      anchor = {
        ...anchor,
        // Step the next handoff off the chain origin's day-of-month, so the rest
        // of the chain stays on the grant's vesting day rather than on whatever
        // day this segment ended on. The `...anchor` spread keeps `origin` for
        // later tails.
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

    const resolution = resolveNonChained(stmt, ctx);
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
      ctx: ResolutionContext;
    }
  | {
      ok: false;
      why: "events";
      reason: NonTemplateReason;
      resolutions: StmtResolution[];
      ctx: ResolutionContext;
    };

/**
 * Assemble one canonical template from the per-statement resolutions, or report
 * why it can't be one: any unresolved start/cliff or unfired event cliff →
 * `unresolved`; a fired event cliff or non-chaining independent DATE grids →
 * `events`.
 */
export const buildTemplate = (
  resolutions: StmtResolution[],
  ctx: ResolutionContext,
): TemplateBuild => {
  const unresolved = (): TemplateBuild => ({
    ok: false,
    why: "unresolved",
    resolutions,
    ctx,
  });
  const events = (reason: NonTemplateReason): TemplateBuild => ({
    ok: false,
    why: "events",
    reason,
    resolutions,
    ctx,
  });

  // Only a genuinely-unresolved or contradictory start poisons the program. An
  // unfired atomic EVENT start (PENDING_EVENT) lowers into the template.
  if (
    resolutions.some(
      (r) => r.start.state === "UNRESOLVED" || r.start.state === "IMPOSSIBLE",
    )
  )
    return unresolved();
  if (
    resolutions.some(
      (r) => r.cliff.state === "UNRESOLVED" || r.cliff.state === "IMPOSSIBLE",
    )
  )
    return unresolved();
  // An event-anchored cliff never fits a template (the deliberate #255 gate —
  // canonical's Cliff is duration-only), but where it goes depends on the firing,
  // read off the cliff record. Unfired, the cliff still gates its
  // whole grid — the program is pending, and routing it to the events arm would
  // release the very installments the cliff holds back. Fired, the lump is
  // datable and the program flattens to dated events.
  if (resolutions.some((r) => r.cliff.state === "EVENT_PENDING"))
    return unresolved();
  const eventCliff = resolutions.find((r) => r.cliff.state === "EVENT_FIRED");
  // TS doesn't carry the `.find` predicate out, so re-narrow before reading the id.
  if (eventCliff && eventCliff.cliff.state === "EVENT_FIRED") {
    return events({ kind: "EVENT_CLIFF", eventId: eventCliff.cliff.eventId });
  }

  const dom = ctx.vesting_day_of_month;
  const statements: VestingStatement[] = [];
  const eventFirings: NonNullable<VestingRuntime["eventFirings"]> = [];
  const blockers: Blocker[] = [];
  // Synthetic events: minted once per distinct externalized anchor (keyed by its
  // DSL definition), so two portions on the byte-identical anchor share one id
  // and one source-map entry.
  const sourceMap: SourceMap = {};
  const synthByDef = new Map<string, string>();
  let synthOrdinal = 0;
  const mintSynthetic = (expr: VestingNodeExpr): string => {
    const definition = stringifyVestingNodeExpr(expr);
    let eventId = synthByDef.get(definition);
    if (eventId === undefined) {
      eventId = syntheticEventId(++synthOrdinal);
      synthByDef.set(definition, eventId);
      sourceMap[eventId] = { definition };
    }
    return eventId;
  };
  // Core dates are plain ISO strings (OCTDate); advanceCursor returns the same.
  let startDate: string | undefined;
  let cursor: string | undefined;

  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    const { type, length, occurrences } = r.periodicity;

    // A committed EARLIER_OF's pending-sibling disclosures (via `disclosuresOf`),
    // so they reach `resolution.pending` and the absence-assumption disclosure —
    // the start itself still lowers as a plain dated anchor below.
    blockers.push(...disclosuresOf(r.start));

    let vesting_base: VestingStatement["vesting_base"];
    if (r.start.state === "PENDING_EVENT") {
      // Unfired atomic EVENT: an EVENT statement with no firing. The projection
      // stays empty until the witness arrives; the blocker carries the
      // pending-ness onto the `template` verdict.
      vesting_base = { type: "EVENT", event_id: r.start.eventId };
      blockers.push(...r.start.blockers);
    } else if (r.start.state === "SYNTHETIC_EVENT") {
      // A pending combinator, gate, or offset anchor: externalize as one
      // synthetic event. No firing yet; the witness is computed by re-resolving
      // the definition at rehydration.
      vesting_base = { type: "EVENT", event_id: mintSynthetic(r.start.expr) };
      blockers.push(...r.start.blockers);
    } else if (
      r.start.state === "UNRESOLVED" ||
      r.start.state === "IMPOSSIBLE"
    ) {
      return unresolved(); // narrowing; unreachable after the guard above
    } else if (r.start.base.type === "EVENT") {
      // A fired offset anchor externalizes here too: the statement references
      // the synthetic event, whose recorded firing is the resolved date
      // (firing + offsets) — true by its definition. The named event's raw
      // firing stays in the consumer's ledger; restating it would add a firing
      // no statement references (runtime validation rejects exactly that), and
      // lowering after the firing has to produce the same artifact that
      // lowering before it plus rehydration would.
      const eventId = r.start.offsetExpr
        ? mintSynthetic(r.start.offsetExpr)
        : r.start.base.eventId;
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
          detail:
            r.chain.role === "tail"
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
    ...(ctx.grantDate ? { grantDate: ctx.grantDate } : {}),
    ...(ctx.vesting_day_of_month !== DEFAULT_VESTING_DAY_OF_MONTH
      ? { vestingDayOfMonth: ctx.vesting_day_of_month }
      : {}),
  };

  return {
    ok: true,
    template: { id: "resolved", statements },
    runtime,
    totalShares: ctx.grantQuantity,
    sourceMap,
    blockers,
  };
};
