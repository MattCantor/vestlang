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
 */
export const unresolvedInstallments = (
  r: StmtResolution,
  stmt: Statement,
  ctx: EvaluationContext,
): InstallmentSet => {
  // A chained THEN tail is welcome once the chaining walk has handed it a
  // concrete start — from there it reads like any self-anchored statement (its
  // own cliff can still gate it). A tail still waiting on its head has nothing
  // to render and is the caller's job to report; reaching here means the
  // routing broke.
  if (stmt.chained && r.start.state !== "RESOLVED") {
    throw new Error(
      "unresolvedInstallments received a chained THEN tail with no handoff date; a pending tail is reported from its resolution, not rendered here.",
    );
  }
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

  // Resolved start: lay the grid from the start date (sprung off the chain origin
  // so a clamped month-end handoff springs back), fold the grant-date lump, then
  // read the cliff off the record.
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
