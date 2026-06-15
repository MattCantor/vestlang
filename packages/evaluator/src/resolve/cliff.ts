// Lower a DSL cliff (`VestingNodeExpr`) onto core's time-based `Cliff`.
//
// Resolve the cliff expression against runtime (reusing the selector layer, with
// the vesting start overlaid so `vestingStart`-relative cliffs resolve), then
// express it as `{ length, period_type, percentage }`:
//   - the duration is measured from the statement anchor to the resolved cliff
//     date, in the statement's period_type when that lands exactly, else in DAYS
//     (always exact, so the lowered cliff reproduces the same date);
//   - the percentage is the proportional pre-cliff share m/N (DSL cliffs are
//     always proportional; non-proportional cliffs arrive only via OCF data).
//
// A bare event cliff (`CLIFF EVENT "ipo"`) is not a `cliff` field; Carta has no
// event anchor on the cliff. It's reported (with its firing, if any) so the
// classifier (4b) can route it structurally: a fired event cliff flattens to
// dated events, an unfired one keeps the whole grid pending. An unresolved
// cliff is reported with blockers.

import type {
  Blocker,
  ResolutionContext,
  ImpossibleBlocker,
  OCTDate,
  VestingNode,
  VestingNodeExpr,
} from "@vestlang/types";
import type { Cliff, PeriodType, VestingDayOfMonth } from "@vestlang/types";
import { addPeriod, daysBetween, gridDate, gt } from "@vestlang/core";
import { fracReduce } from "@vestlang/utils";
import { eventBaseId, isGatedNode, systemAnchorOffset } from "@vestlang/walk";
import { evaluateVestingNodeExpr } from "../evaluate/selectors.js";
import { isPickedResolved, probeLaterOf } from "../evaluate/utils.js";
import type { PickReturn } from "../evaluate/utils.js";
import {
  isVestingStartPlaceholder,
  type CliffEvaluationContext,
} from "../evaluate/vestingNode/vestingBase.js";

export type LoweredCliff =
  | { state: "NONE" }
  | { state: "RESOLVED"; cliff: Cliff }
  // Event-anchored cliff whose event is on record. `effectiveAt` is where the
  // cliff lands — the firing shifted by any offsets on the cliff anchor (`CLIFF
  // EVENT ipo + 1 month` lands a month after the firing). The record carries the
  // date so downstream routing never has to re-consult the events map.
  | { state: "EVENT_FIRED"; eventId: string; effectiveAt: OCTDate }
  // Event-anchored cliff still waiting on its event. No date yet — fired-ness is
  // the state, not an absent field, so routing can't quietly treat an unfired
  // cliff as no cliff.
  | { state: "EVENT_PENDING"; eventId: string }
  // A pending cliff the renderer reproduces without re-resolving. `shape` carries
  // the render variance (only the unresolved renderer branches on it):
  //   - `symbolic`: no placeable grid, so the tranches are start-relative.
  //   - `dated`: the grid is placeable from the resolved start; only the cliff
  //     lump's exact spot is still open.
  //   - `dated-floor`: a partial `LATER OF` whose `floor` is the resolved branch's
  //     date — the lump can only move later than that lower bound, so every
  //     pre-cliff tranche folds onto it.
  // `eventId` is event identity that survived a gate (a pending BEFORE/AFTER gate
  // on `CLIFF EVENT x ...`): identity only, read by the storable-reason scan so a
  // gated event cliff still reports "no schema home, ever" (EVENT_CLIFF) rather
  // than "can't be placed yet" (DEFERRED_CLIFF). It rides only the `symbolic` and
  // `dated` shapes — a `floor` comes only from a combinator (`NODE_LATER_OF`),
  // which has no event id, so a floor never coexists with one.
  | {
      state: "UNRESOLVED";
      blockers: Blocker[];
      shape:
        | { kind: "symbolic"; eventId?: string }
        | { kind: "dated"; eventId?: string }
        | { kind: "dated-floor"; floor: OCTDate };
    }
  // A contradictory cliff, parallel to an IMPOSSIBLE start. The source's blockers
  // are already ImpossibleBlocker[], so no cast is needed when it's produced.
  | { state: "IMPOSSIBLE"; blockers: ImpossibleBlocker[] };

// A gate verdict's UNRESOLVED shape is only ever `dated` or `symbolic` — the gate
// path has no resolved branch to fold from, so it never produces `dated-floor`.
// Naming that narrower type lets the call sites stamp an event id onto the shape
// without TS fearing a `{ dated-floor, eventId }` phantom.
type GateUnresolved = {
  state: "UNRESOLVED";
  blockers: Blocker[];
  shape:
    | { kind: "symbolic"; eventId?: string }
    | { kind: "dated"; eventId?: string };
};

// The verdict a BEFORE/AFTER gate forces on a cliff, read off the cliff
// expression's resolution: a violated gate kills it (IMPOSSIBLE), a still-pending
// gate holds it (UNRESOLVED), a satisfied gate clears (undefined) and the caller
// proceeds with its own lowering. Both cliff lowering paths route their gate
// through here so the violated/pending/satisfied split can't drift between them —
// that drift was #113/#116. The caller supplies `dated` (is the grid placeable
// yet?) and an optional blocker filter (the deferred path drops the vestingStart
// placeholder, which it reports on the start, not the cliff).
const gateVerdict = (
  res: PickReturn<VestingNode>,
  dated: boolean,
  filter: (b: Blocker[]) => Blocker[] = (b) => b,
):
  | GateUnresolved
  | Extract<LoweredCliff, { state: "IMPOSSIBLE" }>
  | undefined => {
  if (res.type === "IMPOSSIBLE")
    return { state: "IMPOSSIBLE", blockers: res.blockers };
  const pending =
    res.type === "UNRESOLVED"
      ? res.blockers
      : res.meta.type === "UNRESOLVED"
        ? res.meta.blockers
        : undefined;
  return pending === undefined
    ? undefined // gate satisfied — caller proceeds
    : {
        state: "UNRESOLVED",
        blockers: filter(pending),
        // The gate path never yields a floor (no resolved branch to fold from)
        // and never sets eventId itself — the two call sites stamp it on.
        shape: dated ? { kind: "dated" } : { kind: "symbolic" },
      };
};

/**
 * Find (length, period_type) such that `addPeriod(anchor, length, period_type)`
 * === cliffDate: prefer the statement's period_type when the cliff lands on an
 * exact number of those units, else fall back to exact DAYS.
 */
const measureDuration = (
  anchor: OCTDate,
  cliffDate: OCTDate,
  periodType: PeriodType,
  dom: VestingDayOfMonth,
): { length: number; period_type: PeriodType } => {
  // Bounded probe in the statement's unit (cap well above any real schedule).
  for (let k = 1; k <= 1200; k++) {
    const d = addPeriod(anchor, k, periodType, dom);
    if (d === cliffDate) return { length: k, period_type: periodType };
    if (gt(d, cliffDate)) break;
  }
  return { length: daysBetween(anchor, cliffDate), period_type: "DAYS" };
};

// `origin` is the date the whole chain started from, used only to count how many
// grid occurrences fall on/before the cliff. Every MONTHS segment grids on the
// origin's day-of-month — the grant's one vesting day — not on the handoff its
// anchor landed on (mid-month off a DAYS run, or clamped onto a short month like
// Feb 28 off a Jan 31 head). So the count has to be taken against that same grid,
// the one core later partitions the lump on. If the two disagreed, the percentage
// baked in here wouldn't match how core splits the tranches and the boundary
// tranche would be misallocated. It defaults to `anchor`, so a head or any
// non-chained statement (its own origin) is unaffected. The cliff *date* below is
// left origin-blind on purpose: a cliff is a fixed duration from this segment's
// anchor, so it lands wherever that duration puts it regardless of which day the
// grid anchors to.
export const lowerCliff = (
  cliffExpr: VestingNodeExpr<"VESTING_START"> | undefined,
  anchor: OCTDate,
  periodType: PeriodType,
  period: number,
  occurrences: number,
  ctx: ResolutionContext,
  origin: OCTDate = anchor,
): LoweredCliff => {
  if (!cliffExpr) return { state: "NONE" };

  // Resolve the cliff expression once, overlaying the vesting start so a
  // `vestingStart`-relative cliff (e.g. "+12 months") resolves. Both the
  // event-cliff routing just below and the time-based lowering further down read
  // this single resolution.
  const overlayCtx: CliffEvaluationContext = { ...ctx, vestingStart: anchor };
  const res = evaluateVestingNodeExpr(cliffExpr, overlayCtx);

  // A genuinely event-anchored cliff has no time-based cliff field, so it's
  // reported as EVENT_FIRED / EVENT_PENDING for the classifier (4b) to route on. A
  // gate on it still decides whether the cliff stands: a violated or still-pending
  // gate routes it away (UNRESOLVED), exactly as a non-event cliff that resolves
  // impossible/pending does — the gate is enforced by the shared evaluator above,
  // never by re-deciding here. (This used to return EVENT unconditionally, so a
  // gate on an event cliff was silently dropped — #113.)
  const evId = eventBaseId(cliffExpr);
  if (evId) {
    // The gate decides whether the event cliff stands. A violated gate kills it; a
    // still-pending gate keeps it unresolved (with a `dated` shape — the grid is
    // placeable from the resolved start); a satisfied gate clears and falls through
    // to the bare event cliff below. Carrying the gate here is what stops it being
    // dropped (#113). A pending gate holds the cliff but doesn't change what it's
    // anchored to, so the event id rides on the UNRESOLVED record's shape for the
    // storable-reason scan. A violated gate passes through untouched: a dead cliff
    // is a contradiction, not an event cliff.
    if (isGatedNode(cliffExpr)) {
      const gate = gateVerdict(res, true);
      if (gate)
        // Stamp the event id onto the gate's shape so the storable-reason scan
        // still reads EVENT_CLIFF. The gate path produces only `dated`/`symbolic`
        // shapes, both of which carry an optional eventId.
        return gate.state === "UNRESOLVED"
          ? { ...gate, shape: { ...gate.shape, eventId: evId } }
          : gate;
    }
    // The shared resolution above already applied the anchor's offsets to the
    // firing, so the resolved date IS the cliff's effective spot. Reading the raw
    // events map here instead would drop the offset and land the lump a period
    // early. The expression resolves exactly when the event has fired (a pending
    // gate was routed away just above).
    return isPickedResolved(res)
      ? { state: "EVENT_FIRED", eventId: evId, effectiveAt: res.meta.date }
      : { state: "EVENT_PENDING", eventId: evId };
  }

  // A violated gate (or any contradictory cliff) is dead.
  if (res.type === "IMPOSSIBLE")
    return { state: "IMPOSSIBLE", blockers: res.blockers };

  // A cliff date is known only when the expression fully resolves. A partial
  // LATER_OF (e.g. `LATER OF(+12 months, EVENT ipo)` with ipo unfired) must not
  // collapse to its resolved branch: that branch is only a lower bound, so the
  // pending event can only push the cliff later. Reporting the floor as RESOLVED
  // would over-vest a still-contingent grant, so leave it UNRESOLVED, mirroring
  // the start path's partial-knowledge handling.
  const cliffDate: OCTDate | undefined = isPickedResolved(res)
    ? res.meta.date
    : undefined;

  if (!cliffDate) {
    // Pending cliff. The grid is placeable from the resolved start, so the render
    // shape is `dated` — the renderer can lay the tranches and only the cliff
    // lump's exact spot is still open. A partial LATER_OF additionally carries its
    // resolved branch's date as the fold floor (`dated-floor`): the lump can only
    // move later than that lower bound, so every pre-cliff tranche sits at it.
    // With no resolved branch there's no floor.
    if (res.type === "PICKED") {
      // Resolved meta was caught by `cliffDate` above, so meta is UNRESOLVED here.
      const blockers = res.meta.type === "UNRESOLVED" ? res.meta.blockers : [];
      const floor =
        cliffExpr.type === "NODE_LATER_OF"
          ? probeLaterOf(cliffExpr, overlayCtx)
          : undefined;
      return floor !== undefined
        ? {
            state: "UNRESOLVED",
            blockers,
            shape: { kind: "dated-floor", floor },
          }
        : { state: "UNRESOLVED", blockers, shape: { kind: "dated" } };
    }
    return {
      state: "UNRESOLVED",
      blockers: res.blockers,
      shape: { kind: "dated" },
    };
  }

  // Cliff at/before the start has no effect.
  if (!gt(cliffDate, anchor)) return { state: "NONE" };

  const dom: VestingDayOfMonth = ctx.vesting_day_of_month;

  // Proportional pre-cliff share: occurrences whose grid date is <= cliffDate,
  // counted on the origin-day grid (see the note on `origin` above) — the same
  // grid core later partitions the lump on.
  const at = gridDate({ anchor, origin, period, periodType, dom });
  let m = 0;
  for (let i = 1; i <= occurrences; i++) {
    if (gt(at(i), cliffDate)) break;
    m++;
  }
  if (m === 0) return { state: "NONE" };

  const { length, period_type } = measureDuration(
    anchor,
    cliffDate,
    periodType,
    dom,
  );
  return {
    state: "RESOLVED",
    cliff: {
      length,
      period_type,
      percentage: fracReduce({ numerator: m, denominator: occurrences }),
    },
  };
};

/**
 * Lower a cliff for a *deferred* start — a pending atomic event, a synthetic
 * combinator event, or a THEN tail whose chain head is still pending — where
 * there is no concrete anchor date to resolve against.
 *
 * Only a `vestingStart`-relative duration cliff in the grid's own unit is
 * derivable anchor-free: `length`/`period_type` are the offset itself, and the
 * pre-cliff share is `floor(cliffLength / step) / occurrences` — independent of
 * when the event eventually fires (a 12-month cliff on a 1-month/48 grid is
 * always 12/48 = 25%). Core's compile then applies it at the firing date,
 * reproducing exactly what the already-fired case (anchored `lowerCliff`) yields.
 *
 * Everything else needs the firing date and can't lower to a `cliff` field:
 *   - a bare event cliff (`CLIFF EVENT x`, no time-based form) keeps its
 *     event-anchoredness, lowered to EVENT_PENDING (on this path the start is
 *     pending, so the cliff's event can never have a placeable date). buildTemplate's
 *     pending-event-cliff guard still routes the statement to `unresolved` — the
 *     routing is unchanged from when this returned a bare UNRESOLVED — but the
 *     record now says *why* it's unstorable (no schema home for an event cliff)
 *     rather than collapsing to "a cliff that can't be placed yet", which is the
 *     same answer a resolved start with this cliff gets.
 *   - a cliff whose unit differs from the grid's (a months-cliff over a days-grid
 *     counts a varying number of pre-cliff occurrences depending on the anchor) is
 *     UNRESOLVED — it genuinely can't be placed until the firing is known.
 */
export const lowerDeferredCliff = (
  cliffExpr: VestingNodeExpr<"VESTING_START"> | undefined,
  periodType: PeriodType,
  period: number,
  occurrences: number,
  ctx: ResolutionContext,
): LoweredCliff => {
  if (!cliffExpr) return { state: "NONE" };

  const off = systemAnchorOffset(cliffExpr, "VESTING_START");
  // Anchor-free only when the cliff is a bare `vestingStart + duration` in the
  // grid's own unit; then length/period_type are the offset and the pre-cliff
  // count is independent of when the start eventually fires. The shared shape-match
  // already excludes MINUS and richer shapes; the `value <= 0` guard is this
  // caller's own (a zero-length forward duration is no cliff here).
  if (off && off.unit === periodType) {
    if (off.value <= 0) return { state: "NONE" };
    const m = Math.min(Math.floor(off.value / period), occurrences);
    if (m === 0) return { state: "NONE" };
    return {
      state: "RESOLVED",
      cliff: {
        length: off.value,
        period_type: off.unit,
        percentage: fracReduce({ numerator: m, denominator: occurrences }),
      },
    };
  }

  // Not derivable without the firing date (an event cliff, a cross-unit duration,
  // or a gated cliff). There's no start anchor to lay a grid against, so it can
  // never be `dated`.
  const gated = isGatedNode(cliffExpr);

  // A bare (ungated) event cliff keeps its event-anchoredness rather than
  // flattening to a generic UNRESOLVED: it's EVENT_PENDING (no date), since a
  // pending start means the cliff's firing can never be placed on this path.
  // buildTemplate routes the pending event cliff to `unresolved` exactly as the
  // old UNRESOLVED return did, but the record now reports the truer cause (no
  // schema home for an event cliff at all). A gated event cliff is handled below —
  // the gate's verdict carries the routing and blockers, with the event identity
  // stamped on the record.
  const evId = eventBaseId(cliffExpr);
  if (evId && !gated) return { state: "EVENT_PENDING", eventId: evId };

  // An ungated, non-event non-derivable cliff (a cross-unit duration) has no gate
  // to report; it stays unresolved until the firing date arrives. No start anchor
  // means no placeable grid, so its shape is fully symbolic.
  if (!gated)
    return { state: "UNRESOLVED", blockers: [], shape: { kind: "symbolic" } };

  // A gated cliff (including a gated *event* cliff): the gate's own verdict is the
  // sharper answer, so surface it. Resolve the cliff with no vesting-start overlay
  // (the subject stays pending) and report its verdict, dropping the vestingStart
  // placeholder — that pending-ness is the start's, reported on the start, not
  // doubled onto the cliff. A satisfied gate doesn't rescue this cliff: with no
  // start anchor it still can't be placed, so it stays unresolved until the firing
  // date arrives.
  const res = evaluateVestingNodeExpr(cliffExpr, ctx);
  const gate = gateVerdict(res, false, (bs) =>
    bs.filter((b) => !isVestingStartPlaceholder(b)),
  );
  const lowered:
    | GateUnresolved
    | Extract<LoweredCliff, { state: "IMPOSSIBLE" }> = gate ?? {
    state: "UNRESOLVED",
    blockers: [],
    shape: { kind: "symbolic" },
  };
  // Same identity rule as the anchored path: a gated *event* cliff keeps its
  // event id on the UNRESOLVED record — whether the gate is pending or cleared
  // without an anchor to place against. Only a violated gate (IMPOSSIBLE)
  // drops it: a dead cliff isn't an event cliff anymore. The deferred path's
  // shapes are always `symbolic` (no anchor to date a grid against, no floor),
  // both of which carry an optional eventId.
  return lowered.state === "UNRESOLVED" && evId !== undefined
    ? { ...lowered, shape: { ...lowered.shape, eventId: evId } }
    : lowered;
};
