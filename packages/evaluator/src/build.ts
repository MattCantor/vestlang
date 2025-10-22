import {
  OCTDate,
  PeriodTag,
  ScheduleExpr,
  Schedule as NormalizedSchedule,
  VestingNodeExpr,
} from "@vestlang/types";
import {
  Blocker,
  EvaluationContext,
  EvaluationContextInput,
  SymbolicDate,
  TrancheStatus,
} from "./types.js";
import { nextDate, pickScheduleByStart } from "./schedule.js";
import { resolveNodeExpr } from "./resolve.js";
import { analyzeUnresolvedReasons } from "./trace.js";
import { createEvaluationContext } from "./utils.js";
import { lt } from "./time.js";

/** --- symbolic helpers --- */
const symStart: SymbolicDate = { type: "START" };
const symCliff: SymbolicDate = { type: "CLIFF" };
const symPlus = (unit: PeriodTag, steps: number): SymbolicDate => ({
  type: "START_PLUS",
  unit,
  steps,
});

// function nextDate(d: OCTDate, unit: PeriodTag, length: number): OCTDate {
//   return unit === "MONTHS" ? addMonthsRule(d, length) : addDays(d, length);
// }

/* Build symbolic dates list (no cliff yet) */
function symbolicCadence(p: {
  type: PeriodTag;
  length: number;
  occurrences: number;
}): SymbolicDate[] {
  const out: SymbolicDate[] = [];
  for (let i = 0; i < p.occurrences; i++) {
    out.push(i === 0 ? symStart : symPlus(p.type, i * p.length));
  }
  return out;
}

function selectScheduleFromExpr(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
): NormalizedSchedule | undefined {
  if (expr.type === "SINGLETON") return expr;
  const picked = pickScheduleByStart(expr.items, ctx, expr.type);
  return picked.chosen ?? undefined;
}

export function buildScheduleWithBlockers(
  expr: ScheduleExpr,
  ctx_input: EvaluationContextInput,
): TrancheStatus[] {
  const ctx = createEvaluationContext(ctx_input);
  // Choose schedule by resolved vesting_start if selector
  const sched = selectScheduleFromExpr(expr, ctx);
  if (!sched) {
    if (expr.type === "SINGLETON") {
      throw new Error(
        `buildScheduleWithBlockers: an expression with type 'SINGLETON' should not return undefined when passed to selectScheduleFromExpr`,
      );
    }
    return [
      {
        index: 0,
        status: { state: "unresolved" },
        amount: ctx.grantQuantity,
        symbolicDate: { type: "START" },
        blockers: [
          {
            type: "UNRESOLVED_SELECTOR",
            selector: expr.type,
          },
        ],
      },
    ];
  }

  // Determine vesting start date and its blockers
  const startRes = resolveNodeExpr(sched.vesting_start, ctx);
  const symbols = symbolicCadence(sched.periodicity);
  const even = 1 / symbols.length;

  // Helper to attach blockers discovered via dependency analysis:
  const blockersFor = (node: VestingNodeExpr): Blocker[] =>
    analyzeUnresolvedReasons(node, ctx);

  // if start unresolved/inactive -> produce symbolic tranches with start blockers
  if (startRes.state !== "resolved") {
    const startBlockers: Blocker[] =
      startRes.state === "inactive"
        ? [
            {
              type: "CONSTRAINT_FALSE_BUT_SATISFIABLE",
              note: "subject contraints currently false",
            },
          ]
        : blockersFor(sched.vesting_start);

    const result: TrancheStatus[] = symbols.map((s, i) => ({
      index: i,
      status: { state: "unresolved" },
      symbolicDate: s,
      amount: even,
      blockers: [...startBlockers],
    }));

    return result;
  }

  // generate concrete cadence from start
  const concrete: OCTDate[] = (() => {
    const out: OCTDate[] = [];
    let d = startRes.date;
    for (let i = 0; i < sched.periodicity.occurrences; i++) {
      out.push(
        i === 0
          ? d
          : (d = nextDate(
              d,
              sched.periodicity.type,
              sched.periodicity.length,
              ctx,
            )),
      );
    }
    return out;
  })();

  // supply synthetic vestingStart event for cliff
  ctx.events["vestingStart"] = startRes.date;

  // handle cliff
  let dates = concrete;
  let cliffSymbolic = false;
  if (sched.periodicity.cliff) {
    const cliffRes = resolveNodeExpr(sched.periodicity.cliff, ctx);
    if (cliffRes.state === "resolved") {
      // catch-up: aggregate earlier installments strictly before cliff
      let idx = 0;
      while (idx < dates.length && lt(dates[idx], cliffRes.date)) idx++;
      if (idx > 0) dates = [cliffRes.date, ...dates.slice(idx)];
    } else {
      // unresolved cliff -> tranche[0] becomes a symbolic cliff and carries blockers
      cliffSymbolic = true;
    }
  }

  // build final tranches (resolved where we have concrete dates)
  const tranches: TrancheStatus[] = dates.map((d, i) => ({
    index: i,
    status: { state: "resolved", date: d },
    amount: 1 / dates.length,
    blockers: [],
  }));

  // if cliff unresolved, rewrite tranche[0] to unresolved with blockers
  if (cliffSymbolic) {
    const cliffBlockers = analyzeUnresolvedReasons(
      sched.periodicity.cliff!,
      ctx,
    );
    tranches[0] = {
      index: 0,
      status: { state: "unresolved" },
      symbolicDate: symCliff,
      amount: 1 / concrete.length,
      blockers: cliffBlockers.length
        ? cliffBlockers
        : [{ type: "UNRESOLVED_CLIFF" }],
    };

    // the rest of the tranches depend on cliff position. Without a resolved cliff we cannot assert their dates.
    // Make them unresolved with START_PLUS symbols and inherit cliff blockers.
    for (let i = 1; i < tranches.length; i++) {
      tranches[i] = {
        index: i,
        status: { state: "unresolved" },
        symbolicDate: symPlus(
          sched.periodicity.type,
          i * sched.periodicity.length,
        ),
        amount: 1 / concrete.length,
        blockers: cliffBlockers.length
          ? cliffBlockers
          : [{ type: "UNRESOLVED_CLIFF" }],
      };
    }
  }

  return tranches;
}
