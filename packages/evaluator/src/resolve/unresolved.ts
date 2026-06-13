// The unresolved producer — symbolic installments + blockers for a statement
// that can't materialize yet. It renders straight from the per-statement record
// (`StmtResolution`) the resolver already produced; it never re-resolves the AST.
// The fully-resolved path is core.compile's job (the unresolved arm discards any
// RESOLVED installments anyway).

import type {
  Blocker,
  EvaluationContext,
  InstallmentSet,
  OCTDate,
  Statement,
} from "@vestlang/types";
import { allocateVector, foldToGrantDate, gridDate } from "@vestlang/core";
import { assertNever } from "@vestlang/utils";
import { amountToQuantify } from "../utils.js";
import {
  makeImpossibleSchedule,
  makeStartPlusSchedule,
  makeUnresolvedCliffInstallment,
  makeUnresolvedCliffSchedule,
  makeUnresolvedVestingStartSchedule,
} from "../evaluate/makeTranches.js";
import type { StmtResolution } from "./lower.js";

const EMPTY: InstallmentSet = { installments: [], blockers: [] };

/**
 * Symbolic installments + blockers for one statement, read off its resolution
 * record. A fully-resolved statement yields no installments (EMPTY); it isn't
 * part of the unresolved verdict — its dated tranches come from core.compile.
 * A THEN tail with a concrete handoff date reads like any self-anchored
 * statement (its own cliff can still gate it); still pending, it renders as
 * the scoped lump below.
 */
export const unresolvedInstallments = (
  r: StmtResolution,
  stmt: Statement,
  ctx: EvaluationContext,
): InstallmentSet => {
  const statementQuantity = amountToQuantify(stmt.amount, ctx.grantQuantity);

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
  if (stmt.chained && r.start.state === "UNRESOLVED") {
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
  const origin = r.origin ?? start;
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
    case "EVENT": {
      // An event cliff: once the event fires the lump is dated (the events arm
      // places it at the cliff's effective date); until then the whole grid
      // waits on that event. Fired-ness is read off the record, the same place
      // the routing reads it.
      return r.cliff.effectiveAt !== undefined
        ? EMPTY
        : makeUnresolvedCliffSchedule(dates, amounts, [
            { type: "EVENT_NOT_YET_OCCURRED", event: r.cliff.eventId },
          ]);
    }
    case "UNRESOLVED": {
      const { dated, probeDate, blockers } = r.cliff;
      if (!dated)
        // No placeable grid — the cliff is fully symbolic, so the tranches are
        // start-relative.
        return makeStartPlusSchedule(amounts, type, length, blockers);
      if (probeDate === undefined)
        return makeUnresolvedCliffSchedule(dates, amounts, blockers);
      // A partial LATER OF: the cliff can only land at or after the resolved
      // branch's date, so fold every pre-cliff tranche onto that lower bound.
      const folded = foldToGrantDate(dates, amounts, probeDate);
      return {
        installments: folded.dates.map((d, i) =>
          makeUnresolvedCliffInstallment(d, folded.amounts[i], blockers),
        ),
        blockers,
      };
    }
    default:
      return assertNever(r.cliff);
  }
};
