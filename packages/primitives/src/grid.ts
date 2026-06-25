// The statement→grid orchestration that sits one layer above the kernel
// (`expandGrid`). It owns the cliff arm-decision, the event-held proportional
// fold at max(floor, firing), the `GridCliff` construction, and the `expandGrid`
// call — the steps the canonical compiler and the evaluator's resolver used to
// hand-roll side by side and could silently drift on.
//
// It is firing-blind and pure: the firing arrives as a plain resolved date, never
// a `firingFor` lookup or a `Map` read. Each caller's only remaining job is to map
// its own source shape (a raw `VestingStatement` + firing lookup on the compile
// side; an already-lowered `LoweredCliff` on the resolution side) into the common
// `CliffInput` below. `GridCliff` stays an internal detail here — callers no longer
// build one.

import type { Fraction, OCTDate } from "@vestlang/types";
import { laterOf } from "./dates.js";
import {
  expandGrid,
  type ExpandGridArgs,
  type GridCliff,
  type RawEvent,
} from "./kernel.js";

/**
 * A statement's cliff, normalized to a firing-blind shape both callers can produce
 * from their own source state. The helper discriminates on `kind`:
 *   - `none`:         no cliff lump — the plain even grid.
 *   - `fixed`:        a duration cliff with an authored percentage, on `baselineDate`.
 *   - `proportional`: an event-held cliff that has fired. The lump folds at
 *                     max(floor, firing) and takes whatever share of the grid
 *                     accrued by then (never an authored percentage — the kernel
 *                     derives the lump from the pre-cliff grid share). `floor` is
 *                     the time-baseline date, absent when there's no time side.
 *   - `skip`:         nothing to emit — an unfired hold, or a dead (UNRESOLVED /
 *                     IMPOSSIBLE) cliff. The helper returns `[]`.
 */
export type CliffInput =
  | { kind: "none" }
  | { kind: "fixed"; baselineDate: OCTDate; percentage: Fraction }
  | { kind: "proportional"; firing: OCTDate; floor?: OCTDate }
  | { kind: "skip" };

/**
 * The grid params shared by both callers, de-duplicated and pinned: everything
 * `expandGrid` needs except the cliff, which the helper builds from `CliffInput`.
 */
export type GridParams = Omit<ExpandGridArgs, "cliff">;

/**
 * Lower one statement onto the kernel: decide the cliff arm, fold an event-held
 * cliff at max(floor, firing), build the `GridCliff`, and call `expandGrid`. A
 * `skip` cliff emits nothing.
 */
export const expandStatementGrid = (
  params: GridParams,
  cliff: CliffInput,
): RawEvent[] => {
  // A skip emits nothing; every other arm resolves to a GridCliff and runs the
  // kernel once. The proportional arm folds the lump date at max(floor, firing) —
  // the floor (the time baseline) is only a floor, and the lump's size is the
  // accrued grid share, not a stored percentage. The floor guard runs before the
  // symmetric `laterOf` primitive (which has no undefined handling); the tie is
  // value-immaterial here (equal ISO strings), so argument order doesn't matter.
  let gridCliff: GridCliff;
  switch (cliff.kind) {
    case "skip":
      return [];
    case "none":
      gridCliff = { kind: "none" };
      break;
    case "fixed":
      gridCliff = {
        kind: "fixed",
        date: cliff.baselineDate,
        percentage: cliff.percentage,
      };
      break;
    case "proportional":
      gridCliff = {
        kind: "proportional",
        date:
          cliff.floor !== undefined
            ? laterOf(cliff.floor, cliff.firing)
            : cliff.firing,
      };
      break;
  }
  return expandGrid({ ...params, cliff: gridCliff });
};
