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
import { allocateVector, foldToGrantDate, gridDate } from "@vestlang/core";
import { assertNever, fracSum } from "@vestlang/utils";
import { claimAllocator } from "../claims.js";
import {
  makeImpossibleSchedule,
  makeStartPlusSchedule,
  makeUnresolvedCliffInstallment,
  makeUnresolvedCliffSchedule,
  makeUnresolvedVestingStartSchedule,
} from "../evaluate/makeTranches.js";
import type { StmtResolution } from "./lower.js";

const EMPTY: InstallmentSet = { installments: [], blockers: [] };

// A portion is "void" when nothing can ever vest from it: a contradictory start,
// or a resolved start whose cliff is contradictory. A pending start is never void
// even with a dead cliff — it waits on the start before the cliff matters.
export const isVoid = (r: StmtResolution): boolean =>
  r.start.state === "IMPOSSIBLE" ||
  (r.start.state === "RESOLVED" && r.cliff.state === "IMPOSSIBLE");

// A statement whose tranches the dated allocator materializes — core.compile in
// the template arm, resolvedInstallments in the events/unresolved arms. These
// never render symbolically; their fractions seed the claim basis below.
const isDated = (r: StmtResolution): boolean =>
  r.start.state === "RESOLVED" &&
  (r.cliff.state === "NONE" ||
    r.cliff.state === "RESOLVED" ||
    r.cliff.state === "EVENT_FIRED");

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
  // claim renders like any pending start: one undated lump whose `unresolved`
  // string names what the chain is waiting on. The returned blocker list is
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
  if (r.start.state !== "RESOLVED") {
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

  // Resolved start: lay the grid from the start date (gridded on the chain origin's
  // day, the grant's vesting day, not the handoff this tail landed on), fold the
  // grant-date lump, then read the cliff off the record.
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
    // A fired event cliff is dated — the events arm places its lump at the
    // effective date — so it contributes nothing to the unresolved verdict.
    case "EVENT_FIRED":
      return EMPTY;
    case "EVENT_PENDING":
      // The event hasn't fired, so the whole grid waits on it.
      return makeUnresolvedCliffSchedule(dates, amounts, [
        { type: "EVENT_NOT_YET_OCCURRED", event: r.cliff.eventId },
      ]);
    case "UNRESOLVED": {
      const { shape, blockers } = r.cliff;
      switch (shape.kind) {
        case "symbolic":
          // No placeable grid — the cliff is fully symbolic, so the tranches are
          // start-relative.
          return makeStartPlusSchedule(amounts, type, length, blockers);
        case "dated":
          return makeUnresolvedCliffSchedule(dates, amounts, blockers);
        case "dated-floor": {
          // A partial LATER OF: the cliff can only land at or after the resolved
          // branch's date, so fold every pre-cliff tranche onto that lower bound.
          const folded = foldToGrantDate(dates, amounts, shape.floor);
          return {
            installments: folded.dates.map((d, i) =>
              makeUnresolvedCliffInstallment(d, folded.amounts[i], blockers),
            ),
            blockers,
          };
        }
        default:
          return assertNever(shape);
      }
    }
    default:
      return assertNever(r.cliff);
  }
};
