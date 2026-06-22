// Lower a DSL cliff (`VestingNodeExpr`) onto core's storable forms: a time-based
// `Cliff` (the Carta time baseline) and/or an `event_condition` (the event hold).
//
// An event-held cliff (`CLIFF EVENT ipo`, `CLIFF LATER OF(12 months, EVENT ipo)`)
// stores at a different joint than vestlang writes it: the time baseline lands in
// the readable `cliff` field, and the event hold lands in `event_condition` — a
// dated tranche carrying an event condition, Carta's HYBRID model. So lowering a
// `LATER OF` cliff partitions its arms: time/date arms feed the `cliff` field,
// event-referencing arms feed `event_condition`. A single bare `EVENT e` uses its
// real id; any richer event side (multiple events, an offset, a gate) collapses to
// one synthetic event whose recipe is re-resolved on reload.
//
// A pure time cliff lowers to `{ length, period_type, percentage }`:
//   - the duration is measured from the statement anchor to the resolved cliff
//     date, in the statement's period_type when that lands exactly, else in DAYS
//     (always exact, so the lowered cliff reproduces the same date);
//   - the percentage is the proportional pre-cliff share m/N (DSL cliffs are
//     always proportional; non-proportional cliffs arrive only via OCF data).
//
// EARLIER OF cliffs are deliberately NOT decomposed here — an `EARLIER OF` is
// acceleration (a ceiling, no Carta home), so it keeps its existing time-cliff /
// unresolved behaviour and never grows an `event_condition`.

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
import { eventBaseId, referencesEvent, isGatedNode } from "@vestlang/walk";
import { evaluateVestingNodeExpr } from "../interpret/selectors.js";
import { pickedDate } from "../interpret/utils.js";
import type { PickReturn } from "../interpret/utils.js";
import {
  isVestingStartPlaceholder,
  type CliffEvaluationContext,
} from "../interpret/vestingNode/vestingBase.js";

// How the event side of a held cliff names its `event_condition`.
//   - `bare`:      a single real `EVENT e`; the template references `e` directly
//                  and the SoR already knows its firing (no sidecar entry).
//   - `synthetic`: anything richer — multiple events, an offset, a gate. lower.ts
//                  mints one `evt:<n>` for it (deduped by rendered recipe) and
//                  stores the rendered `expr` in the sidecar so a reload
//                  re-resolves it (→ max of the event arms, the gated date, …).
type EventSide =
  | { kind: "bare"; eventId: string }
  | { kind: "synthetic"; expr: VestingNodeExpr<"VESTING_START"> };

export type LoweredCliff =
  | { state: "NONE" }
  | { state: "RESOLVED"; cliff: Cliff }
  // An event-held cliff. The grid is held until the event fires; the storable
  // form is the optional time `cliff` (the Carta baseline) plus the `event`
  // hold. In resolution mode the resolved firing rides on `firing` (and the time
  // baseline's date, if any, on `cliffDate`) so the projection can fold at
  // max(cliffDate, firing); the interchange (firing-blind) build leaves both unset
  // and projects nothing.
  | {
      state: "EVENT_HELD";
      // The time baseline arm, lowered as an ordinary duration cliff. Absent for a
      // bare `CLIFF EVENT e` (no time side at all).
      cliff?: Cliff;
      // The resolved date of the time baseline (the floor in the max). Present
      // whenever `cliff` is — they come from the same arm.
      cliffDate?: OCTDate;
      event: EventSide;
      // The resolved condition firing (resolution mode, event fired). Undefined
      // when firing-blind or still pending.
      firing?: OCTDate;
      // The event side's own pending blockers, set only while the hold is unfired
      // (no `firing`). buildTemplate discloses the hold off these so the held grid
      // names the REAL underlying events (`a`/`b`), never the minted synthetic id —
      // an `evt:<n>` would leak an internal name out to MCP/CLI consumers. Omitted
      // (and unread) once fired.
      blockers?: Blocker[];
    }
  // A pending cliff the renderer reproduces without re-resolving. `shape` carries
  // the render variance (only the unresolved renderer branches on it):
  //   - `symbolic`: no placeable grid, so the tranches are start-relative.
  //   - `dated`: the grid is placeable from the resolved start; only the cliff
  //     lump's exact spot is still open.
  //   - `dated-floor`: a partial `LATER OF` whose `floor` is the resolved branch's
  //     date — the lump can only move later than that lower bound, so every
  //     pre-cliff tranche folds onto it.
  // Used only for a non-event cliff that can't be placed yet (a cross-unit
  // duration on the deferred path). An event-held cliff routes to EVENT_HELD even
  // when pending — the hold is the state, never an absent field.
  | {
      state: "UNRESOLVED";
      blockers: Blocker[];
      shape:
        | { kind: "symbolic" }
        | { kind: "dated" }
        | { kind: "dated-floor"; floor: OCTDate };
    }
  // A contradictory cliff, parallel to an IMPOSSIBLE start. The source's blockers
  // are already ImpossibleBlocker[], so no cast is needed when it's produced.
  | { state: "IMPOSSIBLE"; blockers: ImpossibleBlocker[] };

// The verdict a BEFORE/AFTER gate forces on a non-event cliff, read off the cliff
// expression's resolution: a violated gate kills it (IMPOSSIBLE), a still-pending
// gate holds it (UNRESOLVED with the gate's blockers), a satisfied gate clears
// (undefined) and the caller proceeds. Only reached for an event-FREE gated cliff
// on the deferred path — an event-referencing gate rides the event_condition path
// instead, where the recipe captures the gate verbatim.
const gateVerdict = (
  res: PickReturn<VestingNode>,
  filter: (b: Blocker[]) => Blocker[] = (b) => b,
):
  | { state: "UNRESOLVED"; blockers: Blocker[]; shape: { kind: "symbolic" } }
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
        shape: { kind: "symbolic" },
      };
};

/** Blockers of a non-resolved pick — mirrors the extraction in resolveStatements
 *  and rehydrate. Used to carry the unfired event side's real-event blockers onto
 *  an EVENT_HELD record (so the hold discloses on the real events, not a synthetic
 *  id). */
const blockersOf = (res: PickReturn<unknown>): Blocker[] => {
  if (res.type === "PICKED") {
    return res.meta.type === "UNRESOLVED" ? res.meta.blockers : [];
  }
  return res.blockers;
};

// Count the grid occurrences whose vesting date falls at or before `cliffDate`,
// on the origin-day grid (see the note on `origin` at `lowerCliff`) — the same
// grid core later partitions the cliff lump on. This is the proportional cliff's
// numerator: a cliff folds whatever the grid has accrued by its date into one
// lump, so zero pre-cliff occurrences means an empty lump, i.e. no cliff at all.
const preCliffCount = (
  cliffDate: OCTDate,
  anchor: OCTDate,
  origin: OCTDate,
  period: number,
  periodType: PeriodType,
  dom: VestingDayOfMonth,
  occurrences: number,
): number => {
  const at = gridDate({ anchor, origin, period, periodType, dom });
  let m = 0;
  for (let i = 1; i <= occurrences; i++) {
    if (gt(at(i), cliffDate)) break;
    m++;
  }
  return m;
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

// Build the `{ length, period_type, percentage }` time cliff for a resolved date,
// or undefined when that date has no effect (at/before the start, or before the
// first installment). Shared by the bare time cliff and the time arm of a held
// `LATER OF` — both want the identical baseline.
const timeCliffAt = (
  cliffDate: OCTDate,
  anchor: OCTDate,
  origin: OCTDate,
  periodType: PeriodType,
  period: number,
  occurrences: number,
  dom: VestingDayOfMonth,
): Cliff | undefined => {
  if (!gt(cliffDate, anchor)) return undefined;
  const m = preCliffCount(
    cliffDate,
    anchor,
    origin,
    period,
    periodType,
    dom,
    occurrences,
  );
  if (m === 0) return undefined;
  const { length, period_type } = measureDuration(
    anchor,
    cliffDate,
    periodType,
    dom,
  );
  return {
    length,
    period_type,
    percentage: fracReduce({ numerator: m, denominator: occurrences }),
  };
};

// A `LATER OF`'s arms, or undefined when `expr` isn't one. The cliff decomposition
// only opens a top-level `LATER OF`; an `EARLIER OF` (acceleration) is left whole.
const laterOfArms = (
  expr: VestingNodeExpr<"VESTING_START">,
): VestingNodeExpr<"VESTING_START">[] | undefined =>
  expr.type === "NODE_LATER_OF" ? [...expr.items] : undefined;

// Does this cliff lower to an `event_condition`? Yes for an event-referencing leaf
// or a top-level `LATER OF` (a hold, or a time baseline + a hold). NOT for a
// top-level `EARLIER OF`: that's acceleration — a ceiling with no Carta home — so
// it keeps its plain time-cliff lowering and never grows an event hold (AC 9). A
// non-event cliff is no, trivially.
const decomposesToEventCondition = (
  expr: VestingNodeExpr<"VESTING_START">,
): boolean => expr.type !== "NODE_EARLIER_OF" && referencesEvent(expr);

// Wrap one or more arms back into a single expression: a lone arm stands on its
// own, several become a `LATER OF` (max of them). Used to rebuild the time side
// and the event side as standalone expressions the rest of the lowering resolves.
const joinLaterOf = (
  arms: VestingNodeExpr<"VESTING_START">[],
): VestingNodeExpr<"VESTING_START"> =>
  arms.length === 1
    ? arms[0]
    : {
        type: "NODE_LATER_OF",
        items: arms as [
          VestingNodeExpr<"VESTING_START">,
          VestingNodeExpr<"VESTING_START">,
          ...VestingNodeExpr<"VESTING_START">[],
        ],
      };

// The event side of a held cliff, classified for `event_condition`. A single bare
// `EVENT e` (leaf node, no offsets, no gate) keeps its real id; anything richer —
// more than one event arm, an offset, or a gate — collapses to one synthetic
// recipe that re-resolves to the max/gated date on reload.
const classifyEventSide = (
  eventArms: VestingNodeExpr<"VESTING_START">[],
): EventSide => {
  if (eventArms.length === 1) {
    const only = eventArms[0];
    const bareId = eventBaseId(only);
    // Bare = a leaf EVENT node (eventBaseId is non-undefined only there) with no
    // offsets and no gate. The `type === "NODE"` re-check lets TS read
    // `offsets`/`condition` — eventBaseId already guarantees it, but doesn't carry
    // the narrowing out.
    if (
      bareId !== undefined &&
      only.type === "NODE" &&
      !isGatedNode(only) &&
      only.offsets.length === 0
    ) {
      return { kind: "bare", eventId: bareId };
    }
  }
  return { kind: "synthetic", expr: joinLaterOf(eventArms) };
};

// `origin` is the date the whole chain started from, used only to count how many
// grid occurrences fall on/before the cliff. Every MONTHS segment grids on the
// origin's day-of-month — the grant's one vesting day — not on the handoff its
// anchor landed on (mid-month off a DAYS run, or clamped onto a short month like
// Feb 28 off a Jan 31 head). So the count has to be taken against that same grid,
// the one core later partitions the lump on. It defaults to `anchor`, so a head or
// any non-chained statement (its own origin) is unaffected. The cliff *date* below
// is left origin-blind on purpose: a cliff is a fixed duration from this segment's
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

  // Overlay the vesting start so a `vestingStart`-relative arm (e.g. "+12 months")
  // resolves. Both the event-cliff decomposition and the time-based lowering read
  // resolutions taken under this overlay.
  const overlayCtx: CliffEvaluationContext = { ...ctx, vestingStart: anchor };

  // An event-referencing cliff decomposes into a time baseline + an event hold.
  // `referencesEvent` descends, so it sees an event hiding in a LATER OF arm or a
  // gate reference (the leaf-only `eventBaseId` never would). A top-level EARLIER OF
  // is excluded — acceleration has no Carta home, so it keeps its existing
  // time-cliff/commit behaviour and never grows an event_condition (AC 9).
  if (decomposesToEventCondition(cliffExpr)) {
    return lowerEventCliff(
      cliffExpr,
      anchor,
      origin,
      periodType,
      period,
      occurrences,
      ctx,
      overlayCtx,
    );
  }

  // A non-event cliff. A violated gate (or any contradictory cliff) is dead.
  const res = evaluateVestingNodeExpr(cliffExpr, overlayCtx);
  if (res.type === "IMPOSSIBLE")
    return { state: "IMPOSSIBLE", blockers: res.blockers };

  // A cliff date is known when the expression fully resolves OR an EARLIER_OF cliff
  // committed to its floor (`pickedDate` covers both). A partial LATER_OF without
  // an event arm can't arise (the event branch above claims every event-referencing
  // cliff), so what's left here is an ordinary date/duration cliff.
  const cliffDate = pickedDate(res);
  if (!cliffDate) {
    return {
      state: "UNRESOLVED",
      blockers: res.type === "UNRESOLVED" ? res.blockers : [],
      shape: { kind: "dated" },
    };
  }

  const dom = ctx.vesting_day_of_month;
  const cliff = timeCliffAt(
    cliffDate,
    anchor,
    origin,
    periodType,
    period,
    occurrences,
    dom,
  );
  return cliff ? { state: "RESOLVED", cliff } : { state: "NONE" };
};

// Lower an event-referencing cliff to a time baseline + an `event_condition`. The
// anchored path: there's a concrete `anchor`, so the time baseline (if any) can be
// dated and the event side resolved against the world.
const lowerEventCliff = (
  cliffExpr: VestingNodeExpr<"VESTING_START">,
  anchor: OCTDate,
  origin: OCTDate,
  periodType: PeriodType,
  period: number,
  occurrences: number,
  ctx: ResolutionContext,
  overlayCtx: CliffEvaluationContext,
): LoweredCliff => {
  const dom = ctx.vesting_day_of_month;
  const arms = laterOfArms(cliffExpr);

  // Partition a top-level LATER OF into event-referencing arms and time/date arms.
  // A bare event cliff (or a gated/offset single event) isn't a LATER OF, so it's
  // the whole expression as the single event arm with no time side.
  const eventArms = arms ? arms.filter((a) => referencesEvent(a)) : [cliffExpr];
  const timeArms = arms ? arms.filter((a) => !referencesEvent(a)) : [];

  // The time baseline: lower the time arms as their own cliff (max of them). Its
  // resolved date is the floor in the eventual max(cliffDate, firing).
  let cliff: Cliff | undefined;
  let cliffDate: OCTDate | undefined;
  if (timeArms.length > 0) {
    const timeRes = evaluateVestingNodeExpr(joinLaterOf(timeArms), overlayCtx);
    const d = pickedDate(timeRes);
    if (d !== undefined) {
      cliff = timeCliffAt(
        d,
        anchor,
        origin,
        periodType,
        period,
        occurrences,
        dom,
      );
      // Keep the date as the fold floor even if it has no lump effect (the firing
      // may still land after it); only drop it when there's a real cliff to store.
      if (cliff) cliffDate = d;
    }
  }

  const event = classifyEventSide(eventArms);

  // Resolve the event side to learn its firing (resolution mode) or its deadness.
  // The gate (if any) is captured verbatim in the recipe, but its verdict still
  // decides the resolution reading: a violated gate is dead, a pending one holds,
  // a satisfied + fired one folds. Resolved here against the same overlay so a
  // `vestingStart`-relative gate reference (rare) lines up.
  const eventRes = evaluateVestingNodeExpr(joinLaterOf(eventArms), overlayCtx);

  // A violated gate (the event fired outside its window) kills the cliff: dead, not
  // held. Mirrors the start path, where a contradictory anchor is IMPOSSIBLE.
  if (eventRes.type === "IMPOSSIBLE")
    return { state: "IMPOSSIBLE", blockers: eventRes.blockers };

  // Fired (and any gate satisfied) → the firing date; else the hold stands with no
  // firing. `pickedDate` covers a resolved bare event and a fully-resolved LATER OF
  // over events; a partial/unresolved one leaves `firing` undefined.
  const firing = pickedDate(eventRes);

  // While the hold is unfired, carry the event side's own pending blockers so
  // buildTemplate discloses on the real events (the synthetic recipe's underlying
  // `a`/`b`), never the minted `evt:<n>`. Only when non-empty, so a fired record is
  // untouched.
  const blockers = firing === undefined ? blockersOf(eventRes) : [];

  return {
    state: "EVENT_HELD",
    ...(cliff ? { cliff } : {}),
    ...(cliffDate ? { cliffDate } : {}),
    event,
    ...(firing ? { firing } : {}),
    ...(blockers.length > 0 ? { blockers } : {}),
  };
};

/**
 * Lower a cliff for a *deferred* start — a pending atomic event, a synthetic
 * combinator event, or a THEN tail whose chain head is still pending — where
 * there is no concrete anchor date to resolve against.
 *
 * A `vestingStart`-relative duration cliff in the grid's own unit is derivable
 * anchor-free: `length`/`period_type` are the offset itself, and the pre-cliff
 * share is `floor(cliffLength / step) / occurrences` — independent of when the
 * event eventually fires (a 12-month cliff on a 1-month/48 grid is always
 * 12/48 = 25%). Core's compile then applies it at the start date, reproducing
 * exactly what the already-fired anchored path yields.
 *
 * An event-referencing cliff still decomposes into a time baseline (any such
 * anchor-free duration arm) + an `event_condition`. On this path the start itself
 * is pending, so the event side is firing-blind — the condition holds and the
 * compiler sequences the start-hold then the cliff-hold (Decision 7). Everything
 * else (a cross-unit duration) stays UNRESOLVED until the firing date arrives.
 */
export const lowerDeferredCliff = (
  cliffExpr: VestingNodeExpr<"VESTING_START"> | undefined,
  periodType: PeriodType,
  period: number,
  occurrences: number,
  ctx: ResolutionContext,
): LoweredCliff => {
  if (!cliffExpr) return { state: "NONE" };

  // An event-referencing cliff on a deferred start: decompose into a relative time
  // baseline (this path expresses a `vestingStart + duration` cliff anchor-free)
  // plus the `event_condition`. The event side is firing-blind here — the start is
  // pending, so the firing can't be placed; the hold stands with no firing. An
  // EARLIER OF is excluded (acceleration, AC 9), same as the anchored path.
  if (decomposesToEventCondition(cliffExpr)) {
    const arms = laterOfArms(cliffExpr);
    const eventArms = arms
      ? arms.filter((a) => referencesEvent(a))
      : [cliffExpr];
    const timeArms = arms ? arms.filter((a) => !referencesEvent(a)) : [];

    // The time baseline, anchor-free: only a bare `vestingStart + duration` arm in
    // the grid's own unit is derivable. A cross-unit or richer time arm can't be
    // placed without the start, so it simply contributes no stored baseline (the
    // condition still holds the whole grid).
    let cliff: Cliff | undefined;
    if (timeArms.length === 1) {
      const rel = relativeDurationCliff(
        timeArms[0],
        periodType,
        period,
        occurrences,
      );
      if (rel) cliff = rel;
    }

    // The event side is firing-blind here (the start itself is pending), so the
    // hold always stands. Resolve it anyway to carry its real-event blockers — the
    // hold then discloses on the underlying events, not the minted synthetic id.
    // Drop any vestingStart placeholder: that pending-ness is the start's, reported
    // on the start, not doubled onto the cliff.
    const eventRes = evaluateVestingNodeExpr(joinLaterOf(eventArms), ctx);
    const blockers = blockersOf(eventRes).filter(
      (b) => !isVestingStartPlaceholder(b),
    );

    return {
      state: "EVENT_HELD",
      ...(cliff ? { cliff } : {}),
      event: classifyEventSide(eventArms),
      ...(blockers.length > 0 ? { blockers } : {}),
    };
  }

  const rel = relativeDurationCliff(cliffExpr, periodType, period, occurrences);
  if (rel) return { state: "RESOLVED", cliff: rel };
  if (rel === null) return { state: "NONE" };

  // A non-event, non-derivable cliff. A gated one surfaces its gate's verdict (so a
  // real condition the grant depends on is disclosed even while the start is
  // pending), dropping the vestingStart placeholder — that pending-ness is the
  // start's, reported on the start, not doubled onto the cliff. An ungated one (a
  // cross-unit duration) simply stays unresolved until the firing date arrives.
  if (isGatedNode(cliffExpr)) {
    const res = evaluateVestingNodeExpr(cliffExpr, ctx);
    const gate = gateVerdict(res, (bs) =>
      bs.filter((b) => !isVestingStartPlaceholder(b)),
    );
    if (gate) return gate;
  }

  return { state: "UNRESOLVED", blockers: [], shape: { kind: "symbolic" } };
};

// A bare `vestingStart + duration` cliff in the grid's own unit, lowered
// anchor-free. Returns the Cliff, `null` when the duration has no effect (zero
// length, or fewer than one step), or `undefined` when the shape isn't derivable
// without the firing (a cross-unit duration, an offset/gate the shape-match
// excludes). The shared shape-match already excludes MINUS and richer shapes.
const relativeDurationCliff = (
  expr: VestingNodeExpr<"VESTING_START">,
  periodType: PeriodType,
  period: number,
  occurrences: number,
): Cliff | null | undefined => {
  const off = systemAnchorOffsetLocal(expr);
  if (!off || off.unit !== periodType) return undefined;
  if (off.value <= 0) return null;
  const m = Math.min(Math.floor(off.value / period), occurrences);
  if (m === 0) return null;
  return {
    length: off.value,
    period_type: off.unit,
    percentage: fracReduce({ numerator: m, denominator: occurrences }),
  };
};

// The lone positive `vestingStart + duration` offset, or undefined for any richer
// shape. Inlined rather than reaching for `systemAnchorOffset` so the cliff
// lowering keeps one shape-match it owns.
const systemAnchorOffsetLocal = (
  expr: VestingNodeExpr<"VESTING_START">,
): { value: number; unit: PeriodType } | undefined => {
  if (
    expr.type !== "NODE" ||
    expr.base.type !== "VESTING_START" ||
    expr.condition !== undefined ||
    expr.offsets.length !== 1
  )
    return undefined;
  const off = expr.offsets[0];
  // `off.unit` is a PeriodTag (DAYS/MONTHS), a subset of PeriodType — the cliff's
  // period_type widens to it safely.
  return off.sign === "PLUS" ? { value: off.value, unit: off.unit } : undefined;
};
