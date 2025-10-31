import {
  EvaluationContext,
  OCTDate,
  Tranche,
  UnresolvedNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { probeLaterOf } from "./utils.js";
import { eq, lt } from "./time.js";

type CliffOpts =
  | {
      type: "RESOLVED";
      pivotDate: OCTDate;
    }
  | {
      type: "UNRESOLVED";
      nodeMeta: UnresolvedNode;
      vestingPeriod: VestingPeriod & {
        cliff: VestingNodeExpr;
      };
      ctx: EvaluationContext;
    };

export function accumulateUntilPivot(
  dates: OCTDate[],
  amounts: number[],
  opts: CliffOpts,
): Tranche[] {
  let pivotDate: OCTDate;

  // Resolved cliff
  if (opts.type === "RESOLVED") {
    pivotDate = opts.pivotDate;

    console.log("accumulateUntilPivot:", pivotDate);
    return applyCliffToDates(dates, pivotDate, amounts, opts);
  }

  // Unresolved cliff
  const { cliff } = opts.vestingPeriod;

  if (cliff.type === "LATER_OF") {
    const probedDate = probeLaterOf(cliff, opts.ctx);
    if (probedDate) {
      pivotDate = probedDate;
      console.log("accumulateUntilPivot:", pivotDate);
      return applyCliffToDates(dates, pivotDate, amounts, opts);
    }
    // return Array.from({ length: dates.length }, (_, i) => ({
    //   amount: amounts[i],
    //   meta: {
    //     state: "UNRESOLVED",
    //     date: { type: "MAYBE_BEFORE_CLIFF" },
    //     blockers: opts.nodeMeta.blockers,
    //   },
    // }));
  }
  return Array.from({ length: dates.length }, (_, i) => ({
    amount: amounts[i],
    meta: {
      state: "UNRESOLVED",
      date: { type: "MAYBE_BEFORE_CLIFF" },
      blockers: opts.nodeMeta.blockers,
    },
  }));
}

function createTranche(
  index: number,
  date: OCTDate,
  newCarry: number,
  opts: CliffOpts,
): Tranche {
  switch (opts.type) {
    case "RESOLVED": {
      return {
        amount: newCarry,
        date,
        meta: { state: "RESOLVED" },
      };
    }
    case "UNRESOLVED": {
      return {
        amount: newCarry,
        meta: {
          state: "UNRESOLVED",
          date: {
            type: "START_PLUS",
            unit: opts.vestingPeriod.type,
            steps: index * opts.vestingPeriod.length,
          },
          blockers: opts.nodeMeta.blockers,
        },
      };
    }
  }
}

function applyCliff(
  index: number,
  date: OCTDate,
  pivotDate: OCTDate,
  amount: number,
  carry: number,
  opts: CliffOpts,
): { tranche?: Tranche; newCarry: number } {
  const isBefore = lt(date, pivotDate);
  const isAt = eq(date, pivotDate);
  const isAtOrBefore = isBefore || isAt;

  if (isAtOrBefore) {
    const newCarry = carry + amount;

    if (isAt) {
      return {
        newCarry,
        tranche: createTranche(index, date, newCarry, opts),
      };
    }

    if (opts.type === "UNRESOLVED") {
      return {
        newCarry,
        tranche: createTranche(index, date, 0, opts),
      };
    }

    return { newCarry };
  } else {
    return {
      newCarry: amount,
      tranche: createTranche(index, date, amount, opts),
    };
  }
}

function applyCliffToDates(
  dates: OCTDate[],
  pivotDate: OCTDate,
  amounts: number[],
  opts: CliffOpts,
): Tranche[] {
  const tranches: Tranche[] = [];
  let carry = 0;
  dates.forEach((date, i) => {
    const { newCarry, tranche } = applyCliff(
      i,
      date,
      pivotDate,
      amounts[i],
      carry,
      opts,
    );
    if (tranche) tranches.push(tranche);
    carry = newCarry;
  });
  return tranches;
}
