import type { OCTDate, Statement, VestingDayOfMonth } from "@vestlang/types";
import { buildStatement } from "./atoms.js";
import { walk } from "./cadence.js";
import { resolvedInstallmentMap } from "./installments.js";
import { EPSILON } from "./residual.js";
import type {
  Component,
  SingleTrancheComponent,
  TrancheInput,
  UniformComponent,
} from "./types.js";

type AmtMap = Map<string, number>;

/** Evaluate a single statement against the grant context and collapse it to a
 * date→amount map; null if anything is unresolved. */
function evalToMap(
  stmt: Statement,
  grantDate: OCTDate,
  totalQuantity: number,
  asOf: OCTDate,
  policy: VestingDayOfMonth,
): AmtMap | null {
  return resolvedInstallmentMap(stmt, {
    grantDate,
    events: {},
    grantQuantity: totalQuantity,
    asOf,
    vesting_day_of_month: policy,
  });
}

function mapsEqual(a: AmtMap, b: AmtMap): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined || Math.abs(v - w) > EPSILON) return false;
  }
  return true;
}

export interface PreGrantResult {
  components: Component[];
  foldCount: number;
  /** Vesting starts inferred by each fold, for diagnostics. */
  vestingStarts: OCTDate[];
}

/**
 * Pre-grant accrual fold.
 *
 * When the vesting start precedes the grant date, the evaluator collapses every
 * pre-grant installment onto the grant date (an implicit grant-date cliff —
 * evaluator `evaluateGrantDate`). The reverse signature is a lump sitting *on*
 * the grant date whose date need NOT lie on the train's day-of-month grid
 * (the grant date is arbitrary — e.g. a hire date). This fold reconnects such a
 * lump to the train that follows it and reinterprets the pair as a single train
 * that began `k` periods before the grant, emitting a plain no-cliff UNIFORM
 * with a back-dated absolute `FROM DATE`.
 *
 * It is mutually exclusive with `foldCliffs`: a cliff lump lands strictly after
 * the grant date, this one lands on it. We do not — and cannot — recover a cliff
 * that elapsed between the (earlier) vesting start and the grant date; the
 * grant-date lump-up has already erased it from the tranche stream.
 *
 * `k` is chosen by evaluation, not arithmetic: for each candidate we build the
 * extended train, evaluate it under the real allocation, and accept the `k`
 * whose output reproduces the observed lump + train exactly. This handles
 * rounded/jittery trains (e.g. 100000 over 48) that `lump = k * perTranche`
 * arithmetic would miss, since the allocation engine computes the true
 * per-tranche amounts and lump-up.
 */
export function foldPreGrant(
  input: TrancheInput[],
  components: Component[],
  grantDate: OCTDate,
  totalQuantity: number,
  asOf: OCTDate,
  policy: VestingDayOfMonth,
): PreGrantResult {
  const gKey = grantDate;

  // The lump must sit exactly on the grant date.
  const single = components.find(
    (c): c is SingleTrancheComponent =>
      c.kind === "SINGLE_TRANCHE" && c.date === gKey,
  );
  if (!single) return { components, foldCount: 0, vestingStarts: [] };

  // Ground-truth tranches by date — the fold is validated against the actual
  // input, not against a reconstruction of the decomposed train.
  const inputMap: AmtMap = new Map();
  for (const t of input) {
    const key = t.date;
    inputMap.set(key, (inputMap.get(key) ?? 0) + t.amount);
  }

  // Candidate trains lie entirely after the grant date — judged by their actual
  // installment dates, not the seed `startDate` (which the decomposer may record
  // on the grant date itself when month-snapping pulls the seed back). A train
  // with a pre-grant installment isn't separable here: that portion would have
  // already lumped onto the grant date. Try the earliest post-grant train first.
  const candidates: { u: UniformComponent; uMap: AmtMap }[] = [];
  for (const c of components) {
    if (c.kind !== "UNIFORM") continue;
    const uMap = evalToMap(
      buildStatement(c, policy),
      grantDate,
      totalQuantity,
      asOf,
      policy,
    );
    if (!uMap || uMap.size === 0) continue;
    if ([...uMap.keys()].some((k) => k <= gKey)) continue;
    candidates.push({ u: c, uMap });
  }
  candidates.sort((a, b) => {
    const fa = [...a.uMap.keys()].reduce((x, y) => (x < y ? x : y));
    const fb = [...b.uMap.keys()].reduce((x, y) => (x < y ? x : y));
    return fa.localeCompare(fb);
  });

  for (const { u, uMap } of candidates) {
    // Expected output of a successful fold: the input amounts on the train's
    // dates plus the lump on the grant date, and nothing else.
    const expected: AmtMap = new Map();
    for (const key of uMap.keys()) expected.set(key, inputMap.get(key) ?? 0);
    expected.set(gKey, inputMap.get(gKey) ?? 0);

    // Extending the train back by k periods grows the grant-date lump
    // monotonically, so the matching k is unique. Center the scan on the
    // equal-installment guess with slack for rounding.
    const per = u.perTrancheAmount > EPSILON ? u.perTrancheAmount : 1;
    const kMax = Math.min(
      600,
      Math.max(1, Math.round(single.amount / per)) + 3,
    );
    for (let k = 1; k <= kMax; k++) {
      let extStart: OCTDate;
      try {
        extStart = walk(u.startDate, u.cadence, -k, policy);
      } catch {
        break;
      }
      const extended: UniformComponent = {
        kind: "UNIFORM",
        startDate: extStart,
        cadence: u.cadence,
        occurrences: u.occurrences + k,
        perTrancheAmount: u.perTrancheAmount,
        total: u.total + single.amount,
      };
      const prod = evalToMap(
        buildStatement(extended, policy),
        grantDate,
        totalQuantity,
        asOf,
        policy,
      );
      if (!prod) continue;
      if (mapsEqual(prod, expected)) {
        const remaining = components.filter((c) => c !== single && c !== u);
        remaining.push(extended);
        // buildUniform anchors FROM DATE one period before startDate; report it.
        let vestingStart = extStart;
        try {
          vestingStart = walk(extStart, u.cadence, -1, policy);
        } catch {
          /* keep extStart */
        }
        return {
          components: remaining,
          foldCount: 1,
          vestingStarts: [vestingStart],
        };
      }
    }
  }

  return { components, foldCount: 0, vestingStarts: [] };
}
