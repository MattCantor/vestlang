import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";
import { buildStatement } from "./atoms.js";
import { resolvedInstallmentMap } from "./installments.js";
import { EPSILON, wholeMultiple } from "./residual.js";
import type {
  Component,
  SingleTrancheComponent,
  UniformComponent,
} from "./types.js";

/**
 * The train's installment dates, earliest first.
 *
 * A `UniformComponent.startDate` is only a *seed*: under a snapping day-of-month
 * convention (e.g. the 29th) the evaluator moves the real installments off it, so
 * we must ask the evaluator rather than trust `startDate`. We evaluate against a
 * far-past grant date so nothing lumps onto a grant cliff; the whole train
 * resolves regardless of any observation date, so none is passed. Returns null if
 * it doesn't fully resolve.
 */
function installmentDates(
  u: UniformComponent,
  policy: VestingDayOfMonth,
): OCTDate[] | null {
  let map;
  try {
    map = resolvedInstallmentMap(buildStatement(u, policy), {
      grantDate: "1900-01-01",
      events: {},
      grantQuantity: u.total,
      vesting_day_of_month: policy,
    });
  } catch {
    return null;
  }
  if (!map) return null;
  return [...map.keys()].sort((a, b) => a.localeCompare(b));
}

/**
 * Re-shape a "coincident lump on a train" into the equivalent "lump one period
 * before a shorter train", so the cliff/pre-grant fold passes can recognize it.
 *
 * `decompose` represents a cliff as a uniform train plus a lone pulse sitting ON
 * the train's first installment date — e.g. `100×4 from Feb` plus a separate
 * `200 on Feb`, which together vest `300,100,100,100`. The fold passes
 * (`foldCliffs`, `foldPreGrant`) instead look for the *offset* form: a lump on
 * one date, then a train that starts one period later (`300 on Feb`, then
 * `100×3 from Mar`). Those two forms produce identical installments, but only the
 * offset one is folded — so the coincident form slips through as two overlapping
 * components and the program reads as `events-only` instead of one cliff.
 *
 * This pass rewrites the former into the latter: fold the train's first tranche
 * into the lump, and start the train at its own second installment. It is a pure
 * re-representation (the projected amounts are unchanged), so it's always safe to
 * run; it does not itself decide "is this a cliff?" — that stays with the fold
 * passes and their grant-date guards downstream.
 *
 * The lump must sit on the train's *actual* first installment (not its seed
 * `startDate`, which a snapping convention can move — see `installmentDates`).
 * That is what separates a real coincident cliff from an off-grid lump that
 * merely shares the train's seed date: the latter is a genuine pre-grant lump and
 * must be left for `foldPreGrant`.
 *
 * Further guards keep it to a clean cliff head:
 *   - the train must be equal-amount (`total === perTranche × occurrences`) — a
 *     jittery/rounded train has no single "first tranche" to peel off cleanly;
 *   - the lump must be a whole multiple of the per-tranche amount;
 *   - the train must have at least 3 occurrences, so shrinking it still leaves a
 *     real (≥2-occurrence) train. A 2-tranche cliff is left alone — rare, and not
 *     worth a single-occurrence special case.
 */
export function splitCoincidentCliffs(
  components: Component[],
  policy: VestingDayOfMonth,
): Component[] {
  const consumed = new Set<SingleTrancheComponent>();
  const shortened = new Map<UniformComponent, UniformComponent>();
  const bumped = new Map<SingleTrancheComponent, SingleTrancheComponent>();

  for (const u of components) {
    if (u.kind !== "UNIFORM") continue;
    if (Math.abs(u.total - u.perTrancheAmount * u.occurrences) > EPSILON) {
      continue; // jittery train — no clean first tranche to fold into the lump
    }
    if (u.occurrences - 1 < 2) continue;

    const dates = installmentDates(u, policy);
    if (!dates || dates.length < 2) continue;
    const firstInstallment = dates[0];
    const secondInstallment = dates[1];

    const lump = components.find(
      (c): c is SingleTrancheComponent =>
        c.kind === "SINGLE_TRANCHE" &&
        c.date === firstInstallment &&
        !consumed.has(c),
    );
    if (!lump) continue;

    const { k, whole } = wholeMultiple(lump.amount, u.perTrancheAmount);
    if (k < 1 || !whole) continue;

    consumed.add(lump);
    bumped.set(lump, {
      kind: "SINGLE_TRANCHE",
      date: firstInstallment,
      amount: lump.amount + u.perTrancheAmount,
    });
    shortened.set(u, {
      kind: "UNIFORM",
      // The shorter train begins at the original train's second installment,
      // which is already on the policy grid (so it stays a clean seed).
      startDate: secondInstallment,
      cadence: u.cadence,
      occurrences: u.occurrences - 1,
      perTrancheAmount: u.perTrancheAmount,
      total: u.perTrancheAmount * (u.occurrences - 1),
    });
  }

  // Rebuild in place: each consumed lump and shortened train swaps for its
  // rewritten version, everything else passes through untouched.
  return components.map((c) => {
    if (c.kind === "UNIFORM") return shortened.get(c) ?? c;
    if (c.kind === "SINGLE_TRANCHE") return bumped.get(c) ?? c;
    return c;
  });
}
