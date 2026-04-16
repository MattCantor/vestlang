import { stringify } from "@vestlang/stringify";
import type {
  allocation_type,
  OCTDate,
  Program,
  vesting_day_of_month,
} from "@vestlang/types";
import { buildStatement } from "./atoms.js";
import { foldCliffs } from "./cliffFold.js";
import { decompose } from "./pursuit.js";
import { ALLOCATION_CANDIDATES, POLICY_CANDIDATES } from "./policy.js";
import type {
  CliffUniformComponent,
  Component,
  InferInput,
  InferResult,
  SingleTrancheComponent,
  TrancheInput,
  UniformComponent,
} from "./types.js";
import { residualAgainstInput, type VerifyContext } from "./verify.js";

function sortInput(tranches: TrancheInput[]): TrancheInput[] {
  return [...tranches].sort((a, b) =>
    (a.date as unknown as string).localeCompare(b.date as unknown as string),
  );
}

function explicitListFallback(sorted: TrancheInput[]): Component[] {
  return sorted.map(
    (t): SingleTrancheComponent => ({
      kind: "SINGLE_TRANCHE",
      date: t.date,
      amount: t.amount,
    }),
  );
}

interface Attempt {
  program: Program;
  components: Component[];
  foldCount: number;
  residual: number;
  policy: vesting_day_of_month;
  allocationType: allocation_type;
  cadencesTried: string[];
}

function runOne(
  sorted: TrancheInput[],
  policy: vesting_day_of_month,
  allocationType: allocation_type,
  totalQuantity: number,
  grantDate: OCTDate,
  asOf: OCTDate,
): Attempt {
  const { components, cadencesTried } = decompose(sorted, policy);
  const { components: folded, foldCount } = foldCliffs(components, policy);
  const program: Program = folded.map((c) => buildStatement(c, policy));

  const verifyCtx: VerifyContext = {
    grantDate,
    totalQuantity,
    asOf,
    vestingDayOfMonth: policy,
    allocationType,
  };
  const { residual } = residualAgainstInput(program, sorted, verifyCtx);

  return {
    program,
    components: folded,
    foldCount,
    residual,
    policy,
    allocationType,
    cadencesTried,
  };
}

export function inferSchedule(input: InferInput): InferResult {
  if (input.tranches.length === 0) {
    throw new Error("inferSchedule: tranches must not be empty");
  }

  const sorted = sortInput(input.tranches);
  const totalQuantity = sorted.reduce((a, t) => a + t.amount, 0);
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;
  const grantDate = input.grantDate ?? firstDate;

  let best: Attempt | null = null;
  const notes: string[] = [];

  // Try every (policy, allocation) combination. Pick the one with lowest
  // residual, breaking ties on decomposition simplicity (fewest program
  // statements). A 32 × 6 = 192-way search, but each attempt bails fast
  // when the grid walks don't align — so it's cheap.
  for (const policy of POLICY_CANDIDATES) {
    for (const alloc of ALLOCATION_CANDIDATES) {
      const attempt = runOne(
        sorted,
        policy,
        alloc,
        totalQuantity,
        grantDate,
        lastDate,
      );
      if (best === null) {
        best = attempt;
        continue;
      }
      const aSize = attempt.program.length;
      const bSize = best.program.length;
      if (attempt.residual < best.residual - 1e-9) {
        best = attempt;
      } else if (
        Math.abs(attempt.residual - best.residual) <= 1e-9 &&
        aSize < bSize
      ) {
        best = attempt;
      }
    }
  }

  if (best === null) throw new Error("inferSchedule: no attempt succeeded");

  if (best.residual >= 1e-6) {
    const fallbackComponents = explicitListFallback(sorted);
    const fallbackProgram: Program = fallbackComponents.map((c) =>
      buildStatement(c, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    );
    const fallbackAttempt: Attempt = {
      program: fallbackProgram,
      components: fallbackComponents,
      foldCount: 0,
      residual: 0,
      policy: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      allocationType: "CUMULATIVE_ROUNDING",
      cadencesTried: best.cadencesTried,
    };
    const { residual: fallbackResidual } = residualAgainstInput(
      fallbackProgram,
      sorted,
      {
        grantDate,
        totalQuantity,
        asOf: lastDate,
        vestingDayOfMonth: fallbackAttempt.policy,
        allocationType: fallbackAttempt.allocationType,
      },
    );
    if (fallbackResidual < best.residual) {
      notes.push(
        "matching-pursuit left nonzero residual; emitted explicit list fallback",
      );
      best = { ...fallbackAttempt, residual: fallbackResidual };
    }
  }

  if (input.grantDate === undefined) {
    notes.push(`grantDate defaulted to first tranche date (${firstDate})`);
  }

  const uniforms = best.components
    .filter((c): c is UniformComponent => c.kind === "UNIFORM")
    .map(({ kind: _kind, ...rest }) => rest);
  const singles = best.components
    .filter((c): c is SingleTrancheComponent => c.kind === "SINGLE_TRANCHE")
    .map(({ kind: _kind, ...rest }) => rest);
  const cliffFolds = best.components.filter(
    (c): c is CliffUniformComponent => c.kind === "CLIFF_UNIFORM",
  ).length;

  return {
    dsl: stringify(best.program),
    program: best.program,
    decomposition: {
      uniforms,
      singles,
      cliffFolds,
    },
    diagnostics: {
      residualError: best.residual,
      totalQuantity,
      vestingDayOfMonth: best.policy,
      allocationType: best.allocationType,
      cadenceTried: best.cadencesTried,
      notes,
    },
  };
}
