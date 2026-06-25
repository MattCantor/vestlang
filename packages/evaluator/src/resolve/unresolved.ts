// The unresolved producer — symbolic installments + blockers for a statement
// that can't materialize yet. It renders straight from the per-statement record
// (`StmtResolution`) the resolver already produced; it never re-resolves the AST.
// The fully-resolved path is core.compile's job (the unresolved arm discards any
// RESOLVED installments anyway).

import type {
  Blocker,
  ResolutionContext,
  InstallmentSet,
  OCTDate,
} from "@vestlang/types";
import {
  allocateVector,
  foldToGrantDate,
  gridDate,
} from "@vestlang/primitives";
import { assertNever, fracSum } from "@vestlang/utils";
import { claimAllocator } from "../claims.js";
import {
  makeImpossibleSchedule,
  makeStartPlusSchedule,
  makeUnresolvedCliffSchedule,
  makeUnresolvedVestingStartSchedule,
} from "../interpret/makeTranches.js";
import type { StmtResolution } from "./lower.js";

const EMPTY: InstallmentSet = { installments: [], blockers: [] };

// A start that settled to a concrete date: a plain RESOLVED, or an EARLIER_OF that
// committed to its floor. Both materialize through the dated path, so every dated-
// vs-pending split keys on this rather than on "=== RESOLVED". A type guard, so a
// caller that passed it can then read `start.date` off the narrowed start.
type DatedStart = Extract<
  StmtResolution["start"],
  { state: "RESOLVED" | "COMMITTED" }
>;
export const isDatedStart = (
  r: StmtResolution,
): r is StmtResolution & { start: DatedStart } =>
  r.start.state === "RESOLVED" || r.start.state === "COMMITTED";

// A portion is "void" when nothing can ever vest from it: a contradictory start,
// or a dated start whose cliff is contradictory. A pending start is never void
// even with a dead cliff — it waits on the start before the cliff matters.
export const isVoid = (r: StmtResolution): boolean =>
  r.start.state === "IMPOSSIBLE" ||
  (isDatedStart(r) && r.cliff.state === "IMPOSSIBLE");

// A statement whose tranches the dated allocator materializes — core.compile in
// the template arm, resolvedInstallments in the events/unresolved arms. These
// never render symbolically; their fractions seed the claim basis below. An
// event-held cliff is dated ONCE FIRED (core/expandResolution folds it at the
// firing); while it's still held it renders symbolically (held tranches), so it's
// not dated then — its shares must survive into the events/unresolved stream.
export const isDated = (r: StmtResolution): boolean =>
  isDatedStart(r) &&
  (r.cliff.state === "NONE" ||
    r.cliff.state === "RESOLVED" ||
    (r.cliff.state === "EVENT_HELD" && r.cliff.firing !== undefined));

// One claim per statement, drawn from a single program-wide cumulative so the
// symbolic side telescopes the way the allocator does. Dated statements seed
// the basis (the allocator already telescoped their tranches to
// floor(grant × their summed fraction), wherever they sit in program order)
// and get a 0 they never spend. Live pending statements draw next, in program
// order; void portions draw last, so a dead clause can't deflate a live one's
// claim. Per-statement splits are provisional — the eventual split depends on
// firing dates — but the totals are exact.
export const symbolicClaims = (
  resolutions: readonly StmtResolution[],
  grantQuantity: number,
): number[] => {
  const basis = fracSum(resolutions.filter(isDated).map((r) => r.percentage));
  const draw = claimAllocator(grantQuantity, basis);
  const claims = new Array<number>(resolutions.length).fill(0);
  resolutions.forEach((r, i) => {
    if (!isDated(r) && !isVoid(r)) claims[i] = draw(r.percentage);
  });
  resolutions.forEach((r, i) => {
    if (isVoid(r)) claims[i] = draw(r.percentage);
  });
  return claims;
};

/**
 * Symbolic installments + blockers for one statement, read off its resolution
 * record. A fully-resolved statement yields no installments (EMPTY); it isn't
 * part of the unresolved verdict — its dated tranches come from core.compile.
 * A THEN tail with a concrete handoff date reads like any self-anchored
 * statement (its own cliff can still gate it); still pending, it renders as
 * the scoped lump below.
 *
 * The claim is handed in by the caller because it's drawn from a program-wide
 * cumulative — one statement can't size itself anymore.
 */
export const unresolvedInstallments = (
  r: StmtResolution,
  ctx: ResolutionContext,
  claim: number,
): InstallmentSet => {
  const statementQuantity = claim;

  // A contradictory start kills the whole portion.
  if (r.start.state === "IMPOSSIBLE")
    return makeImpossibleSchedule([statementQuantity], r.start.blockers);

  // A cliff's own pending/dead blockers (a BEFORE/AFTER gate) ride alongside a
  // pending start, so an unfired start never hides the gate the cliff is on.
  const cliffBlockers: Blocker[] =
    r.cliff.state === "UNRESOLVED" || r.cliff.state === "IMPOSSIBLE"
      ? r.cliff.blockers
      : [];

  // A THEN tail behind a pending head. The chaining walk injected this start
  // (state UNRESOLVED, carrying the head's own blockers), so the tail's share
  // claim renders like any pending start: one undated lump. What the chain is
  // waiting on is reported once, on the schedule-level pending blocker list
  // (`resolution.pending`), not restated per installment. The returned blocker list is
  // scoped to the cliff's own contribution, though — the head is a statement
  // in the same program and reports its start blockers itself, so restating
  // them on every tail would duplicate each pending-head blocker in the
  // published list. (The walk lowers a pending tail's authored cliff on the
  // deferred path, so a pending or dead gate's blockers arrive here through
  // `cliffBlockers`; a bare event cliff carries no blockers of its own — its
  // identity rides on the record for the storable-reason scan instead.)
  //
  // The role check is what decides tail-ness; the start clause is only there so
  // TS can read `r.start.blockers` (which exists on the UNRESOLVED arm, not on
  // every start). The producer guarantees a pending-tail always has an UNRESOLVED
  // start, but that isn't in the type, so the clause stays explicit.
  if (r.chain.role === "pending-tail" && r.start.state === "UNRESOLVED") {
    const { installments } = makeUnresolvedVestingStartSchedule(
      [statementQuantity],
      [...r.start.blockers, ...cliffBlockers],
    );
    return { installments, blockers: cliffBlockers };
  }

  // A start with no date yet. A combinator that partially settled (a LATER OF
  // whose later arm we know) keeps its cadence, so its tranches lay out as
  // symbolic start+N steps; everything else is one undated lump for the portion.
  // IMPOSSIBLE returned above; RESOLVED and COMMITTED both have a date and fall to
  // the dated path below — so this branch is exactly the three pending arms, listed
  // explicitly so TS can read their `blockers`.
  if (
    r.start.state === "PENDING_EVENT" ||
    r.start.state === "SYNTHETIC_EVENT" ||
    r.start.state === "UNRESOLVED"
  ) {
    const blockers = [...r.start.blockers, ...cliffBlockers];
    if (r.start.state === "SYNTHETIC_EVENT" && r.start.partial) {
      const { type, length, occurrences } = r.periodicity;
      return makeStartPlusSchedule(
        allocateVector(statementQuantity, occurrences),
        type,
        length,
        blockers,
      );
    }
    return makeUnresolvedVestingStartSchedule([statementQuantity], blockers);
  }

  // Dated start (RESOLVED or committed floor): lay the grid from the start date
  // (gridded on the chain origin's day, the grant's vesting day, not the handoff
  // this tail landed on), fold the grant-date lump, then read the cliff off the
  // record.
  const start = r.start.date;
  // A RESOLVED start is only ever a head or a dated tail; a head is its own
  // origin, a dated tail carries the chain's first day.
  const origin = r.chain.role === "tail" ? r.chain.origin : start;
  const { type, length, occurrences } = r.periodicity;
  const amounts = allocateVector(statementQuantity, occurrences);
  const at = gridDate({
    anchor: start,
    origin,
    period: length,
    periodType: type,
    dom: ctx.vesting_day_of_month,
  });
  let dates: OCTDate[] = Array.from({ length: occurrences }, (_, i) =>
    at(i + 1),
  );
  if (ctx.grantDate) {
    const folded = foldToGrantDate(dates, amounts, ctx.grantDate);
    dates = folded.dates;
    amounts.length = 0;
    amounts.push(...folded.amounts);
  }

  switch (r.cliff.state) {
    // No cliff, or one that fully resolved — the grid is materialized by
    // core.compile, so it contributes nothing to the unresolved verdict.
    case "NONE":
    case "RESOLVED":
      return EMPTY;
    case "IMPOSSIBLE":
      return makeImpossibleSchedule(amounts, r.cliff.blockers);
    // An event-held cliff. Fired, it's materialized by core.compile /
    // expandResolution (the fold at the firing), so it contributes no symbolic
    // installments here. Unfired, the whole grid is held: render the held tranches
    // symbolically so the shares survive into the events/unresolved stream (the
    // template arm instead lets core.compile hold them, and discloses the blocker
    // in buildTemplate). The hold's witnesses are the cliff's OWN pending blockers —
    // the real underlying events. A bare side carries `EVENT_NOT_YET_OCCURRED(real
    // id)`; a synthetic side (a `LATER OF` over events, a gate) names the real `a`/`b`
    // via its selector tree, never the minted `evt:<n>`. Both ride onto the held
    // tranches AND onto the returned blocker list so a held-head chain's tail (#412)
    // discloses what it's waiting on, not just a bare symbolic lump.
    case "EVENT_HELD": {
      if (r.cliff.firing !== undefined) return EMPTY;
      const blocker: Blocker[] = r.cliff.blockers ?? [];
      // Disclose the cliff floor on each held tranche: a `LATER OF` cliff whose
      // time arm resolved carries that date as `cliffDate` (the earliest anything
      // could land), so surface it as the tranche's `floor` without disturbing its
      // honest cadence `date`. A bare `CLIFF EVENT e` has no time arm, so
      // `cliffDate` is undefined and the floor is simply omitted.
      return makeUnresolvedCliffSchedule(
        dates,
        amounts,
        blocker,
        r.cliff.cliffDate,
      );
    }
    case "UNRESOLVED": {
      const { shape, blockers } = r.cliff;
      switch (shape.kind) {
        case "symbolic":
          // Unreachable by construction. A "symbolic" cliff (one with no
          // placeable grid) is only ever produced for a start that has no date
          // yet — and those starts return far above this point, through the
          // pending-start arms. By the time we get here the start has a concrete
          // date, and a dated start always lowers its cliff to a "dated" shape,
          // never "symbolic". So this pairing — dated start, symbolic cliff —
          // can't be built from any real schedule.
          //
          // We throw rather than render because the inputs here are already
          // folded onto the grant date, and the symbolic builder would re-derive
          // each tranche's step from its array position. Once a leading tranche
          // has been folded away, those positions no longer match the true
          // occurrence numbers, so it would emit silently wrong step counts.
          // Failing loudly turns that latent drift into an obvious upstream bug.
          throw new Error(
            "unresolved renderer: a dated start produced a symbolic cliff shape, " +
              "which is impossible by construction (symbolic cliffs only pair with " +
              "pending starts, handled earlier). An upstream change has broken the " +
              "start/cliff-shape pairing; fix that rather than rendering here, " +
              "since the folded amounts would drift the start-relative step numbers.",
          );
        case "dated":
          return makeUnresolvedCliffSchedule(dates, amounts, blockers);
        default:
          return assertNever(shape);
      }
    }
    default:
      return assertNever(r.cliff);
  }
};
