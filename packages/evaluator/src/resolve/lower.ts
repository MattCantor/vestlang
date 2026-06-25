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
import { CONTINGENT_START_SENTINEL, apportionStored } from "@vestlang/utils";
import type {
  Cliff,
  Fraction,
  PeriodTag,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/types";
import {
  DEFAULT_VESTING_DAY_OF_MONTH,
  RUNTIME_BASE_KEYS,
} from "@vestlang/types";
import { advanceCursor, eq } from "@vestlang/primitives";
import { eventBaseId, isGatedNode, referencesEvent } from "@vestlang/walk";
import { evaluateScheduleExpr } from "../interpret/selectors.js";
import { amountToFraction } from "../claims.js";
import { isPickedCommitted, isPickedResolved } from "../interpret/utils.js";
import { lowerCliff, lowerDeferredCliff, type LoweredCliff } from "./cliff.js";
import { SYNTHETIC_START_EVENT_ID, syntheticEventId } from "./synthetic.js";
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
    // An unfired *bare* EVENT start — atomic, ungated, offset-free. canonical
    // stores it as the hoisted contingent start (sentinel startDate + one
    // `evt:start` recipe) rather than poisoning the program to `unresolved`.
    // `expr` is the bare start node, rendered into the `evt:start` recipe so a
    // reload re-derives the real date; `eventId` is kept for the disclosure/blocker
    // paths. The blockers carry the pending-ness.
    | {
        state: "PENDING_EVENT";
        eventId: string;
        expr: VestingNodeExpr;
        blockers: Blocker[];
      }
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

  // A bare atomic EVENT start — a plain named event, no guard, no offsets. It's a
  // contingent start: `buildTemplate` hoists it to the sentinel startDate and
  // externalizes its `EVENT <id>` recipe under the one reserved `evt:start` key.
  // `expr` carries that recipe; `eventId` is retained only for the
  // disclosure/blocker paths. Gated or offset event-base nodes were already
  // claimed by the synthetic branch above.
  if (res.type === "UNRESOLVED" && sb.type === "EVENT") {
    return {
      percentage,
      periodicity,
      start: {
        state: "PENDING_EVENT",
        eventId: sb.eventId,
        expr: vs,
        blockers,
      },
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

// The later of a firing and an optional time-baseline floor — the fold point of an
// event-held cliff (max(cliffDate, firing)). OCTDate is ISO YYYY-MM-DD, so lexical
// order is calendar order. Exported so classify.ts's events-arm expansion folds the
// held grid at the SAME point this handoff re-anchors the tail to — if the two
// drifted, a tail would date off a different fold than the head actually folds to.
export const laterOf = (
  firing: OCTDate,
  floor: OCTDate | undefined,
): OCTDate => (floor !== undefined && floor > firing ? floor : firing);

// Where a chain segment hands off to the next tail, given the segment's concrete
// start, its lowered cliff, and the chain origin. Shared by `anchorAfter` (a head)
// and the dated-tail loop (a tail), so a held cliff folds the handoff identically
// wherever it sits in the chain.
//
// The handoff cursor is the segment's bare grid end — `advanceCursor` of the start —
// EXCEPT when an event-held cliff is in force:
//   - unfired (no `firing`): the held grid hasn't ended, so there's nothing to hand
//     off. The tail can't vest until the event arrives → a PENDING anchor carrying
//     the held cliff's own blockers (the real underlying events, never the minted
//     `evt:<n>`). Firing-blind, every held cliff reads unfired, so the interchange
//     build always takes this branch.
//   - fired: the grid folds at `max(cliffDate, firing)`, so a tail behind it can't
//     start before that fold. The handoff is `max(bareGridEnd, foldPoint)` — the
//     bare end already wins for an early firing under a long grid (the counter-case),
//     and the fold point wins for a late firing, so the tail never precedes its
//     head's fold. No extra step past the max: `bareGridEnd` is already the advanced
//     cursor, and the fold point is an absolute date the next tail grids off directly.
const handoffAnchor = (
  start: OCTDate,
  base: { type: "DATE" } | { type: "EVENT"; eventId: string },
  offsetExpr: VestingNodeExpr | undefined,
  cliff: LoweredCliff,
  periodicity: StmtResolution["periodicity"],
  origin: OCTDate,
  dom: ResolutionContext["vesting_day_of_month"],
): ChainAnchor => {
  // An unfired event hold ends nothing, so there's no date to hand off (and no need
  // to advance the grid). Short-circuit before the cursor math.
  if (cliff.state === "EVENT_HELD" && cliff.firing === undefined) {
    return { kind: "PENDING", blockers: cliff.blockers ?? [] };
  }

  const { occurrences, length, type } = periodicity;
  const bareGridEnd = advanceCursor(
    start,
    occurrences,
    length,
    type,
    dom,
    origin,
  );
  // A fired hold pulls the handoff forward to its fold point when that lands after
  // the bare grid end; otherwise the bare end stands. (The unfired hold already
  // returned above, so an EVENT_HELD cliff here always has a firing.)
  const cursor =
    cliff.state === "EVENT_HELD" && cliff.firing !== undefined
      ? laterOf(laterOf(cliff.firing, cliff.cliffDate), bareGridEnd)
      : bareGridEnd;

  return base.type === "EVENT"
    ? {
        kind: "EVENT",
        eventId: base.eventId,
        ...(offsetExpr ? { offsetExpr } : {}),
        cursor,
        origin,
      }
    : { kind: "DATE", cursor, origin };
};

/** The anchor a following THEN tail inherits from the statement just resolved. */
const anchorAfter = (
  r: StmtResolution,
  dom: ResolutionContext["vesting_day_of_month"],
): ChainAnchor => {
  // A committed start is a concrete date too, so a chain hands off from it exactly
  // as from a RESOLVED one. This statement heads the chain, so it is its own origin:
  // passing its start as the origin makes this first handoff a step from the vesting
  // day onto itself (no effect); the origin only bites on later handoffs, once the
  // cursor has drifted off the vesting day or clamped onto a short month. The cliff
  // is read too — a head held on an unfired event hasn't ended, so it hands off
  // nothing (PENDING); a fired held cliff folds the handoff at max(cliffDate, firing)
  // so the tail can't vest before the head releases.
  if (r.start.state === "RESOLVED" || r.start.state === "COMMITTED") {
    return handoffAnchor(
      r.start.date,
      r.start.base,
      r.start.offsetExpr,
      r.cliff,
      r.periodicity,
      r.start.date,
      dom,
    );
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
      const origin = anchor.origin;
      // The handoff date is this tail's start. A cliff on the tail therefore
      // measures from the handoff, exactly as a head cliff measures from the
      // head's start, with no special casing. An event-origin tail keeps the
      // head's event id (and any offset recipe) so buildTemplate can tell the chain
      // apart from two independent portions that happen to share an event.
      const base: { type: "DATE" } | { type: "EVENT"; eventId: string } =
        anchor.kind === "EVENT"
          ? { type: "EVENT", eventId: anchor.eventId }
          : { type: "DATE" };
      const offsetExpr =
        anchor.kind === "EVENT" ? anchor.offsetExpr : undefined;
      // Pass the chain origin so a sub-annual cliff counts its pre-cliff tranches
      // on the same grid this tail vests on — the grant's vesting day — rather than
      // on the handoff day the previous segment happened to end on.
      const cliff = lowerCliff(
        p.cliff,
        date,
        p.type,
        p.length,
        p.occurrences,
        ctx,
        origin,
      );
      out.push({
        percentage,
        periodicity,
        start: {
          state: "RESOLVED",
          date,
          base,
          ...(offsetExpr ? { offsetExpr } : {}),
        },
        cliff,
        // A dated tail: the handoff produced a date, and `origin` is the chain's
        // starting date (not this tail's handoff) so a later materialization
        // grids the tail on the grant's vesting day.
        chain: { role: "tail", origin },
      });
      // The next handoff steps off this tail's grid end on the chain origin's
      // day-of-month — but a held cliff on the tail itself (Decision A) folds that
      // handoff exactly as it does on a head: an unfired hold yields nothing (PENDING,
      // so every later tail pends behind it), a fired one re-anchors at
      // max(gridEnd, foldPoint). `handoffAnchor` reads the tail's lowered cliff and
      // returns the right anchor for both, preserving the chain origin and event id.
      anchor = handoffAnchor(
        date,
        base,
        offsetExpr,
        cliff,
        periodicity,
        origin,
        dom,
      );
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
      // The externalized recipes: at most the one reserved `evt:start` entry for a
      // contingent start (the rendered DSL of a pending start, so a reload
      // re-derives its real date), plus one `evt:<n>` per synthetic event-held
      // cliff. Empty for a plain dated schedule.
      sourceMap: SourceMap;
      // Pending-ness under a `template` verdict: a contingent start whose event
      // hasn't fired. Advisory — the program is still a valid template; these say
      // the projection is still empty. (An event-held cliff's pending-ness rides on
      // its blockers too, but those are gathered by the resolution-arm producers,
      // not here.)
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

// A start that anchors its own component (a non-chained head). A contingent
// component head (PENDING_EVENT / SYNTHETIC_EVENT) is the one shape that hoists to
// the sentinel start; a dated head hoists/chains a real date. Both are origins —
// canonical hoists exactly one, so more than one distinct origin can't be one
// template.
const isContingentStart = (s: StmtResolution["start"]): boolean =>
  s.state === "PENDING_EVENT" || s.state === "SYNTHETIC_EVENT";

/**
 * Assemble one canonical template from the per-statement resolutions, or report
 * why it can't be one. The canonical template hoists exactly one start. A single
 * contingent start (its date unknown until an event fires) hoists to the
 * CONTINGENT_START_SENTINEL with its recipe in a reserved `evt:start` entry; a
 * plain dated start hoists its real date. More than one distinct start origin (two
 * events, a dated start beside an event start) can't be one template →
 * `events`/MULTIPLE_START_ORIGINS. An event-held cliff stays a template (it stores
 * as a time `cliff` + an `event_condition`). What still falls out: an
 * unresolved/contradictory start, or a cliff with no storable home at all (a
 * cross-unit deferred cliff, a contradiction) → `unresolved`; non-chaining
 * independent DATE grids → `events`.
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

  // A contradictory start is terminal no matter how many origins there are, so it
  // poisons first (classify rolls a wholly-void program up to impossible). Then a
  // genuinely-unresolved HEAD start poisons too — but a pending-tail's UNRESOLVED
  // start is legitimate (it rides a contingent head; see below), so the
  // unresolved-start check is scoped to heads.
  if (resolutions.some((r) => r.start.state === "IMPOSSIBLE")) {
    return unresolved();
  }

  // The component heads (each its own FROM). Heads are the grant's start origins;
  // tails ride their head's origin. canonical hoists one start, so a contingent
  // head can't coexist with any other origin.
  const heads = resolutions.filter((r) => r.chain.role === "head");
  const contingentHeads = heads.filter((r) => isContingentStart(r.start));
  const hasContingentStart = contingentHeads.length > 0;

  if (heads.some((r) => r.start.state === "UNRESOLVED")) {
    return unresolved();
  }

  // A contingent start consumes the one hoisted origin. A second origin — another
  // contingent head, or any dated head beside it — has nowhere to land. (The grant
  // stays DSL-expressible; a record keeper would split the origins into separate
  // grants.)
  if (hasContingentStart && heads.length > 1) {
    return events({
      kind: "MULTIPLE_START_ORIGINS",
      detail:
        "More than one distinct start origin on one grant (a contingent start cannot share canonical's single hoisted start with another origin).",
    });
  }

  if (
    resolutions.some(
      (r) => r.cliff.state === "UNRESOLVED" || r.cliff.state === "IMPOSSIBLE",
    )
  )
    return unresolved();
  // An event-held cliff (EVENT_HELD) no longer falls out of the template floor:
  // it stores as a time `cliff` (the baseline, if any) plus an `event_condition`
  // on the statement, the Carta HYBRID model. So it stays on this template path —
  // the cliff routing above only turns away cliffs with no storable home at all
  // (a cross-unit deferred cliff, a contradiction).

  const dom = ctx.vesting_day_of_month;
  const statements: VestingStatement[] = [];
  const blockers: Blocker[] = [];
  // The recipes externalized out-of-band: the one reserved `evt:start` key for a
  // contingent start (set on the contingent-start path below) and a numbered
  // `evt:<n>` per synthetic event-held cliff (minted by `mintSynthetic`).
  const sourceMap: SourceMap = {};
  // Resolution-mode condition firings, keyed by event_id so two statements holding
  // on the same event share one firing. Empty in the firing-blind interchange
  // build (its cliffs carry no `firing`), which is what keeps that verdict's
  // runtime firing-free.
  const eventFirings: NonNullable<VestingRuntime["eventFirings"]> = [];
  // Synthetic event-held cliffs: minted once per distinct rendered recipe, so two
  // statements holding on the byte-identical event side share one id and one
  // source-map entry.
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
  // Record one condition firing per event_id (multiple statements may hold on the
  // same event). A later collision on the same id at a different date can't arise
  // from lowering — the same event resolves once — so the first wins.
  const recordFiring = (eventId: string, date: OCTDate): void => {
    if (!eventFirings.some((f) => f.event_id === eventId))
      eventFirings.push({ event_id: eventId, date });
  };
  // Core dates are plain ISO strings (OCTDate); advanceCursor returns the same. On
  // the contingent path startDate is the sentinel; on the dated path it's the
  // hoisted real date the cursor chains off.
  let startDate: string | undefined;
  let cursor: string | undefined;

  if (hasContingentStart) {
    // Exactly one contingent head (the multi-origin guard ran above), every other
    // statement a pending-tail chaining off it. Hoist the sentinel and externalize
    // the head's recipe once under `evt:start`; the chain re-anchors to the
    // re-derived real date on reload (the tails are DATE statements off the one
    // hoisted start).
    const head = contingentHeads[0];
    const headStart = head.start;
    // narrowing: contingentHeads only holds PENDING_EVENT / SYNTHETIC_EVENT.
    if (
      headStart.state !== "PENDING_EVENT" &&
      headStart.state !== "SYNTHETIC_EVENT"
    ) {
      return unresolved(); // unreachable
    }
    startDate = CONTINGENT_START_SENTINEL;
    sourceMap[SYNTHETIC_START_EVENT_ID] = {
      definition: stringifyVestingNodeExpr(headStart.expr),
    };
    blockers.push(...headStart.blockers);
  }

  // Lower every statement's share fraction to its stored Numeric AS A SET, not one
  // at a time: a schedule of exact thirds summing to 1 must store a set that still
  // sums to 1, or the single-cumulative allocator floors the last share away (the
  // #413 conservation bug). `apportionStored` truncates each to ten places and hands
  // the lost ulps back by largest remainder. The array is indexed by loop position
  // `i` below — every statement here produces exactly one `statements.push`, in this
  // order, so the index lines up with no realignment.
  const storedPercentages = apportionStored(
    resolutions.map((r) => r.percentage),
  );

  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    const { type, length, occurrences } = r.periodicity;

    // A committed EARLIER_OF's pending-sibling disclosures (via `disclosuresOf`),
    // so they reach `resolution.pending` and the absence-assumption disclosure —
    // the start itself still lowers as a plain dated anchor below.
    blockers.push(...disclosuresOf(r.start));

    // Anchoring is implicit — every statement dates off the one hoisted start. On
    // the contingent path the cursor stays the sentinel (the projection's
    // sentinel-skip / re-derived start handles dating), so we only run the
    // cursor/eq continuation check on the dated path.
    if (!hasContingentStart) {
      // A resolved/committed dated start.
      if (r.start.state === "RESOLVED" || r.start.state === "COMMITTED") {
        const date = r.start.date;
        if (cursor === undefined) {
          startDate = date;
        } else if (!eq(date, cursor)) {
          // A second independent DATE grid that doesn't chain — not one template.
          // This is also where a fired held-cliff head's re-anchored tail lands
          // (#412): the head's grid folds at its firing, so the tail's start jumps
          // past the bare cursor and the chain can't be one DATE template — it
          // routes to the events arm, which dates the fold and the tail correctly.
          return events({ kind: "OVERLAPPING_ABSOLUTE_STARTS" });
        }
        // The continuation check above compares each statement's start against
        // this cursor, so the cursor must step exactly the way the resolve
        // pre-pass did. Both feed `advanceCursor` the chain origin (the first DATE
        // start). If only one did, a month-end handoff would produce Mar 31 on one
        // side and Mar 28 on the other, the eq check would miss, and a valid chain
        // would wrongly split off to events-only. On the first DATE statement
        // startDate is this start, so the two are equal.
        cursor = advanceCursor(
          date,
          occurrences,
          length,
          type,
          dom,
          startDate ?? date,
        );
      } else {
        // A pending-tail's UNRESOLVED start. Reachable when a dated head's grid is
        // held on an unfired event cliff (firing-blind, or the event hasn't fired):
        // the head isn't contingent, so this dated path runs, and its tails came
        // back as pending-tails (#412). They can't date here → route to the
        // unresolved arm, where the held-head chain reports as EVENT_CHAINED_TAIL /
        // DEFERRED_CLIFF. (A pending *head* start can't appear: the contingent branch
        // owns those, and an UNRESOLVED head was turned away by the guard above.)
        return unresolved();
      }
    }

    // The time `cliff` field — present on a plain time cliff (RESOLVED) and on the
    // time baseline of an event-held cliff (EVENT_HELD with a baseline arm).
    const cliff: Cliff | undefined =
      r.cliff.state === "RESOLVED"
        ? r.cliff.cliff
        : r.cliff.state === "EVENT_HELD"
          ? r.cliff.cliff
          : undefined;

    // A committed top-level EARLIER_OF cliff's pending-sibling disclosures (an
    // unfired EVENT arm, stamped through the floor), mirroring the start push
    // above — they reach `resolution.pending` and the absence assumption so the
    // committed floor doesn't read as certain. Only the RESOLVED arm carries them;
    // the field is absent on a plain resolved cliff.
    if (r.cliff.state === "RESOLVED") {
      blockers.push(...(r.cliff.blockers ?? []));
    }

    // The event hold. A bare event side uses its real id; a richer one mints a
    // synthetic recipe. In resolution mode the resolved firing rides into
    // runtime.eventFirings so core.compile can fold at max(cliff date, firing).
    let event_condition: { event_id: string } | undefined;
    if (r.cliff.state === "EVENT_HELD") {
      const eventId =
        r.cliff.event.kind === "bare"
          ? r.cliff.event.eventId
          : mintSynthetic(r.cliff.event.expr);
      event_condition = { event_id: eventId };
      if (r.cliff.firing !== undefined) {
        recordFiring(eventId, r.cliff.firing);
      } else {
        // The hold is still in force (firing-blind, or the event hasn't fired).
        // Disclose it on the template verdict's blocker list so resolution.pending
        // reflects the held grid — the projection itself is empty until it fires.
        // We carry the event side's OWN blockers (set on the cliff when unfired):
        // for a bare side that's `EVENT_NOT_YET_OCCURRED(real id)`; for a synthetic
        // side it names the real underlying events (`a`/`b`), never the minted
        // `evt:<n>` — pushing the synthetic id here would leak an internal name to
        // MCP/CLI consumers. Pushing nothing would silently hide a held grant (the
        // template arm has no symbolic-installment fallback), so the carried
        // blockers are the only disclosure that the grid is held. The interchange
        // build is firing-blind and never reads these, so this stays
        // firing-invariant.
        blockers.push(...(r.cliff.blockers ?? []));
      }
    }

    // The internal share is an exact Fraction; the stored field is a Numeric
    // decimal apportioned across the whole schedule above, so read this statement's
    // share from the schedule-whole set rather than truncating it in isolation.
    const percentage = storedPercentages[i];

    // A *pure milestone* — vests entirely on its event hold, with no time grid —
    // stores with no `schedule`. The omission predicate is a three-way conjunction,
    // and all three clauses are load-bearing:
    //   - event_condition present: a schedule-less statement must still vest on
    //     something, so a milestone always has the event hold;
    //   - no time cliff: a floored milestone (`CLIFF LATER OF(12 months, EVENT ipo)`)
    //     carries an EVENT_HELD baseline and must keep its schedule so the floor
    //     date survives;
    //   - degenerate one-lump grid (occurrences === 1 && period === 0): a hybrid
    //     (`OVER 48 EVERY 1 CLIFF EVENT ipo`) keeps its full 48-occurrence schedule —
    //     keying on the grid SHAPE here, not on `(event_condition && !cliff)`, is
    //     what keeps the hybrid's schedule intact.
    // The degenerate grid the milestone would otherwise carry is eliminated from
    // STORAGE only; the compiler re-synthesizes the one-lump params to fold a
    // milestone on the shared grid kernel (compile.ts), by design.
    if (
      event_condition !== undefined &&
      cliff === undefined &&
      occurrences === 1 &&
      length === 0
    ) {
      statements.push({ order: i + 1, percentage, event_condition });
    } else {
      statements.push({
        order: i + 1,
        percentage,
        schedule: {
          occurrences,
          period: length,
          period_type: type,
          ...(cliff ? { cliff } : {}),
        },
        ...(event_condition ? { event_condition } : {}),
      });
    }
  }

  // Field names pinned to `RUNTIME_BASE_KEYS` (the single source of truth in
  // canonical.ts) via `satisfies keyof typeof`, then used as computed keys below,
  // so a rename or removal of a `RuntimeBase` field is a compile error right here.
  // The construction stays deliberately heterogeneous — each field has its own
  // source and elision guard, and `eventFirings` isn't a RuntimeBase field at all —
  // so this must NOT collapse into a uniform copy-loop. The one drift this can't
  // catch is an *addition*: a new optional field isn't type-forced to be populated
  // here. That's caught instead at the key set's own `satisfies`, which sends the
  // editor back to wire the new field a source and a guard below.
  const START_DATE = "startDate" satisfies keyof typeof RUNTIME_BASE_KEYS;
  const GRANT_DATE = "grantDate" satisfies keyof typeof RUNTIME_BASE_KEYS;
  const DAY_OF_MONTH =
    "vestingDayOfMonth" satisfies keyof typeof RUNTIME_BASE_KEYS;
  const runtime: VestingRuntime = {
    ...(startDate !== undefined ? { [START_DATE]: startDate } : {}),
    // The resolution-mode condition firings (empty firing-blind, which keeps the
    // interchange runtime firing-free). core.compile reads them to place each
    // event hold's fold. Not a RuntimeBase field — it lives only on VestingRuntime,
    // so it carries no computed key.
    ...(eventFirings.length > 0 ? { eventFirings } : {}),
    // Grant-date implicit cliff: amounts scheduled before the grant existed fold
    // onto grantDate. Core's compile applies this when runtime.grantDate is set.
    ...(ctx.grantDate ? { [GRANT_DATE]: ctx.grantDate } : {}),
    ...(ctx.vesting_day_of_month !== DEFAULT_VESTING_DAY_OF_MONTH
      ? { [DAY_OF_MONTH]: ctx.vesting_day_of_month }
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
