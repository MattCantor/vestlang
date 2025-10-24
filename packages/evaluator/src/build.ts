import {
  ScheduleExpr,
  Schedule as NormalizedSchedule,
  Statement as NormalizedStatement,
  VestingNodeExpr,
  PeriodTag,
} from "@vestlang/types";
import {
  Blocker,
  EvaluationContext,
  EvaluationContextInput,
  SymbolicDate,
  TrancheStatus,
} from "./types.js";
import { pickScheduleByStart } from "./selectors.js";
import { resolveNodeExpr } from "./resolve.js";
import { analyzeUnresolvedReasons } from "./trace.js";
import { createEvaluationContext } from "./utils.js";
import { expandAllocatedSchedule } from "./expandSchedule.js";
import { allocateQuantity, amountToQuantify } from "./allocation.js";

/** --- symbolic helpers --- */
const symStart: SymbolicDate = { type: "START" };
const symCliff: SymbolicDate = { type: "CLIFF" };
const symPlus = (unit: PeriodTag, steps: number): SymbolicDate => ({
  type: "START_PLUS",
  unit,
  steps,
});

function selectScheduleFromExpr(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
): NormalizedSchedule | undefined {
  if (expr.type === "SINGLETON") return expr;
  const picked = pickScheduleByStart(expr.items, ctx, expr.type);
  return picked.chosen ?? undefined;
}

export function buildScheduleWithBlockers(
  stmt: NormalizedStatement,
  ctx_input: EvaluationContextInput,
): TrancheStatus[] {
  const ctx = createEvaluationContext(ctx_input);
  const { amount, expr } = stmt;
  const quantity = amountToQuantify(amount, ctx.grantQuantity);

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
        symbolicDate: symStart,
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
  const occurrences = sched.periodicity.occurrences;
  const unit = sched.periodicity.type;
  const step = sched.periodicity.length;

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

    const n = Math.max(occurrences, 0);
    if (n === 0) {
      return [];
    }

    const amounts = allocateQuantity(quantity, n, ctx.allocation_type);
    const symbols: SymbolicDate[] = Array.from({ length: n }, (_, i) =>
      i === 0 ? symStart : symPlus(unit, i * step),
    );
    const result: TrancheStatus[] = symbols.map((s, i) => ({
      index: i,
      status: { state: "unresolved" },
      symbolicDate: s,
      amount: amounts[i],
      blockers: [...startBlockers],
    }));

    return result;
  }

  // Start resolved -> expand dates (and cliff catch-up) in one place
  const expanded = expandAllocatedSchedule(expr, ctx, amount, quantity);
  const dates = expanded.tranches.map((t) => t.date);
  const n = dates.length || occurrences; // dates length should equal occurrences. fallback for safety
  // NOTE: consider throwing an error if dates.length !== occurrences

  // If cliff unresolved -> rewrite as symbolic (CLIFF + START_PLUS), keep portions
  if (
    sched.periodicity.cliff &&
    expanded.cliff &&
    expanded.cliff.input.state !== "resolved"
  ) {
    const blockers = analyzeUnresolvedReasons(sched.periodicity.cliff, ctx);
    const amounts = allocateQuantity(
      quantity,
      Math.max(n, 0),
      ctx.allocation_type,
    );
    const out: TrancheStatus[] = [];

    if (n === 0) return [];

    // tranche[0] = CLIFF (unresolved)
    out.push({
      index: 0,
      status: { state: "unresolved" },
      symbolicDate: symCliff,
      amount: amounts[0],
      blockers: blockers.length ? blockers : [{ type: "UNRESOLVED_CLIFF" }],
    });

    // the rest depend on cliff position -> symbolic START_PLUS
    for (let i = 1; i < n; i++) {
      out.push({
        index: i,
        status: { state: "unresolved" },
        symbolicDate: symPlus(unit, i * step),
        amount: amounts[i],
        blockers: blockers.length ? blockers : [{ type: "UNRESOLVED_CLIFF" }],
      });
    }

    return out;
  }

  // Fully resolved dates -> resolved tranche statuses
  const trancheStatuses: TrancheStatus[] = dates.map((date, i) => ({
    index: i,
    status: { state: "resolved", date },
    amount: allocateQuantity(quantity, dates.length, ctx.allocation_type)[i],
    blockers: [],
  }));

  // Aggregate consecutive identical statuses
  const aggregated: TrancheStatus[] = trancheStatuses.reduce((acc, current) => {
    const prev = acc[acc.length - 1];

    if (
      prev &&
      prev.status.state === "resolved" &&
      current.status.state === "resolved" &&
      prev.status.date === current.status.date
    ) {
      // Merge into previous item
      prev.amount += current.amount;
    } else {
      acc.push({ ...current });
    }

    return acc;
  }, [] as TrancheStatus[]);

  return aggregated;
}
