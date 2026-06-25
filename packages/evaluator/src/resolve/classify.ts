// Verdict classification — the `events` and `unresolved` arms of ResolveResult.
//
//  - events: the program resolves to concrete dated amounts but doesn't fit one
//    template (independent non-chaining grids, or a fired event-anchored cliff).
//    Each resolved statement is expanded to dated events, flattened, sorted, and
//    allocated with the single running cumulative (core's allocator). A sibling
//    portion still waiting on an event isn't dropped: its shares ride along as
//    symbolic installments, its witnesses as blockers. The facts survive; the
//    intent does not.
//  - unresolved: a start/cliff can't be materialized yet. Reuses vestlang's
//    evaluator to produce the symbolic (dateless) installments + blockers. A
//    wholly-void program rolls up from here to the `impossible` arm.

import type {
  Blocker,
  ResolutionContext,
  ImpossibleBlocker,
  ImpossibleInstallment,
  ResolvedInstallment,
  SymbolicInstallment,
} from "@vestlang/types";
import {
  addPeriod,
  allocateWithProvenance,
  coalesceAtGrantDate,
  expandStatementGrid,
  type AllocationContribution,
  type CliffInput,
  type RawEvent,
} from "@vestlang/primitives";
import { numericToFraction } from "@vestlang/utils";
import { makeResolvedInstallment } from "../interpret/makeTranches.js";
import {
  unresolvedInstallments,
  isDated,
  isVoid,
  symbolicClaims,
} from "./unresolved.js";
import { disclosuresOf } from "./lower.js";
import type { StmtResolution, TemplateBuild } from "./lower.js";
import type { ClassifiedVerdict, StatementContribution } from "./types.js";

// A resolution paired with its TRUE program-order key (1-based), carried through
// the dated/resolved filters so the allocator and the partition both key on
// program order rather than the filtered subset's position (the same 1-based order
// `buildTemplate` stamps on `RawEvent.statementOrder`).
interface OrderedResolution {
  r: StmtResolution;
  order: number;
}

// What `classify` hands back: the verdict plus the per-statement partition of the
// headline allocation, seeded over the whole program (built here for the
// events/unresolved/impossible arms; resolveToCore builds the template arm's).
export interface ClassifyResult {
  verdict: ClassifiedVerdict;
  contributions: StatementContribution[];
}

/**
 * Expand one resolved statement to its dated fraction-of-grant events, honoring a
 * time-based or fired-event cliff. Same shared kernel core's compile uses, called
 * per statement so independent grids can coexist in the events arm.
 */
const expandResolution = (
  r: StmtResolution,
  order: number,
  ctx: ResolutionContext,
): RawEvent[] => {
  // RESOLVED or a committed EARLIER_OF floor — both carry a date to grid from.
  if (r.start.state !== "RESOLVED" && r.start.state !== "COMMITTED") return [];
  const anchor = r.start.date;
  // For a chain tail, `anchor` is the handoff the previous segment ended on (Feb 28
  // off a Jan 31 head, or mid-month off a DAYS run) while `origin` keeps the chain's
  // first day (the 31st), so the grid lands on the grant's vesting day. A head is
  // its own origin. (A RESOLVED start is only ever a head or a dated tail, never a
  // pending-tail, so the role check is total here.)
  const origin = r.chain.role === "tail" ? r.chain.origin : anchor;
  const { type, length: period, occurrences } = r.periodicity;
  const dom = ctx.vesting_day_of_month;

  // Map the lowered cliff state onto the firing-blind CliffInput; the shared helper
  // owns the arm decision, the proportional fold, and the kernel call.
  let cliff: CliffInput;
  if (r.cliff.state === "RESOLVED") {
    // A time-based cliff is a pure duration from the anchor (no origin).
    cliff = {
      kind: "fixed",
      baselineDate: addPeriod(
        anchor,
        r.cliff.cliff.length,
        r.cliff.cliff.period_type,
        dom,
      ),
      // The embedded canonical Cliff stores a Numeric decimal; the kernel works
      // in exact rational.
      percentage: numericToFraction(r.cliff.cliff.percentage),
    };
  } else if (r.cliff.state === "EVENT_HELD") {
    // An event-held cliff that landed in an events build via another cause (e.g.
    // multiple start origins). Unfired, the hold gates the whole grid → skip
    // (emit nothing). Fired, the lump folds at max(cliff baseline date, firing) —
    // the baseline contributes only its date as a floor, the lump's size is
    // whatever share the grid accrued by then (proportional).
    cliff =
      r.cliff.firing === undefined
        ? { kind: "skip" }
        : {
            kind: "proportional",
            firing: r.cliff.firing,
            floor: r.cliff.cliffDate,
          };
  } else if (r.cliff.state === "NONE") {
    cliff = { kind: "none" };
  } else {
    // UNRESOLVED / IMPOSSIBLE: nothing here is datable. Only a vacuous
    // 0-occurrence statement legitimately reaches this with nothing to lose.
    cliff = { kind: "skip" };
  }

  return expandStatementGrid(
    {
      anchor,
      origin,
      period,
      periodType: type,
      occurrences,
      stmtFraction: r.percentage,
      statementOrder: order,
      dom,
    },
    cliff,
  );
};

/**
 * Dated tranches for the resolved statements, plus the per-event provenance the
 * partition is built from: expand each to dated fraction-events and hand the lot
 * to the kernel's provenance-carrying allocator, which orders them, turns the
 * fractions into exact integer shares, and folds anything pre-grant onto the grant
 * date. `installments` is byte-identical to the old `allocateEvents` path;
 * `contributions` is the same surviving rows keyed by program order.
 */
const allocateResolutions = (
  dated: OrderedResolution[],
  ctx: ResolutionContext,
): {
  installments: ResolvedInstallment[];
  contributions: AllocationContribution[];
} => {
  const { installments, contributions } = allocateWithProvenance(
    dated.flatMap(({ r, order }) => expandResolution(r, order, ctx)),
    ctx.grantQuantity,
    ctx.grantDate,
  );
  return {
    installments: installments.map((t) =>
      makeResolvedInstallment(t.date, t.amount),
    ),
    contributions,
  };
};

/**
 * Build the per-statement partition, seeded over the WHOLE program (one entry per
 * statement, in program order, even when a statement contributes no rows). A dated
 * statement's installments are its `AllocationContribution` rows grant-date-coalesced
 * into the per-clause display shape; a pending / void statement's are its symbolic
 * tranches sized by its slice of the program-wide claim vector (`symbolicClaims`).
 * The two together sum to the headline by construction. Shared across the
 * events/unresolved/impossible arms and the template arm.
 */
export const buildStatementContributions = (
  resolutions: StmtResolution[],
  allocationContributions: AllocationContribution[],
  claims: number[],
  ctx: ResolutionContext,
): StatementContribution[] => {
  const rowsByOrder = new Map<number, AllocationContribution[]>();
  for (const c of allocationContributions) {
    const rows = rowsByOrder.get(c.statementOrder);
    if (rows) rows.push(c);
    else rowsByOrder.set(c.statementOrder, [c]);
  }
  return resolutions.map((r, i) => {
    const statementOrder = i + 1;
    if (isDated(r)) {
      const rows = rowsByOrder.get(statementOrder) ?? [];
      return {
        statementOrder,
        installments: coalesceAtGrantDate(rows, ctx.grantDate).map((t) =>
          makeResolvedInstallment(t.date, t.amount),
        ),
      };
    }
    // A pending / void statement renders symbolically; its share is the
    // program-wide claim, never a dated row.
    return {
      statementOrder,
      installments: unresolvedInstallments(
        r,
        ctx,
        claims[i],
      ).installments.filter((inst) => inst.state !== "RESOLVED"),
    };
  });
};

/**
 * The events arm routes here when the *dated* part of the program forced it (a
 * second independent grid, a fired event cliff) — which says nothing about the
 * sibling portions. A statement whose start is still waiting (a pending event,
 * an unsettled combinator) passed buildTemplate's guards and must not vanish:
 * its shares are emitted as symbolic installments and its witnesses as
 * blockers, the same rendering the unresolved arm uses for a mixed program.
 */
const eventsArm = (
  build: Extract<TemplateBuild, { why: "events" }>,
): ClassifyResult => {
  const { ctx, resolutions, reason } = build;
  const symbolic: SymbolicInstallment[] = [];
  const blockers: Blocker[] = [];
  const dated: OrderedResolution[] = [];
  // Split each statement the same way the claim basis and the partition do — on
  // `isDated` — so the headline stream and its per-statement partition count the
  // very same statements (the by-construction tie). `isDated` is a dated start
  // (RESOLVED or a committed floor) whose cliff can actually place a grid: NONE, a
  // resolved time cliff, or a FIRED event-held cliff. A start whose cliff can't —
  // a contradictory BEFORE/AFTER gate (IMPOSSIBLE), an unsettled gate (UNRESOLVED),
  // or an unfired event hold — is NOT dated: expandResolution would skip its whole
  // grid, dropping its shares from the stream. Such a statement reaches this arm
  // when a contingent sibling forced the program to events via
  // MULTIPLE_START_ORIGINS, ahead of buildTemplate's cliff guard. It routes through
  // the symbolic branch, where its IMPOSSIBLE / held tranches ride into the headline
  // — the same rendering the unresolved arm gives a mixed program.
  const claims = symbolicClaims(resolutions, ctx.grantQuantity);
  resolutions.forEach((r, i) => {
    // A committed floor's disclosures (via `disclosuresOf`) surface here regardless
    // of which branch the statement takes, or they'd vanish from resolution.pending
    // and the absence-assumption disclosure — the symbolic branch's
    // unresolvedInstallments reads the cliff, not the start's absence assumptions.
    blockers.push(...disclosuresOf(r.start));
    if (isDated(r)) {
      dated.push({ r, order: i + 1 });
      return;
    }
    // buildTemplate already poisons UNRESOLVED/IMPOSSIBLE *starts* to the unresolved
    // arm, and a pending chain head keeps its tails out of the events build too — so
    // what lands here is a pending event, a synthetic combinator start, or a dated
    // start whose cliff can't place a grid (a void or unsettled-cliff sibling).
    const ev = unresolvedInstallments(r, ctx, claims[i]);
    for (const inst of ev.installments) {
      if (inst.state !== "RESOLVED") symbolic.push(inst);
    }
    blockers.push(...ev.blockers);
  });
  const alloc = allocateResolutions(dated, ctx);
  return {
    verdict: {
      kind: "events",
      installments: [...alloc.installments, ...symbolic],
      blockers,
      reason,
    },
    contributions: buildStatementContributions(
      resolutions,
      alloc.contributions,
      claims,
      ctx,
    ),
  };
};

const unresolvedArm = (
  build: Extract<TemplateBuild, { why: "unresolved" }>,
): ClassifyResult => {
  const { ctx, resolutions } = build;
  const symbolic: SymbolicInstallment[] = [];
  const blockers: Blocker[] = [];
  // The fully-resolved siblings, kept to materialize their dated tranches below.
  const resolvedResolutions: OrderedResolution[] = [];
  // Every statement renders off its resolution record, THEN tails included:
  // the chaining walk already injected a tail's start (a concrete handoff
  // date, or UNRESOLVED with the head's blockers while the head is pending).
  // A pending tail comes back as a symbolic lump with its returned blockers
  // scoped so the head's aren't restated per tail.
  // Dated statements get a 0 claim they never use — their paths return EMPTY
  // before any amount matters.
  const claims = symbolicClaims(resolutions, ctx.grantQuantity);
  resolutions.forEach((r, i) => {
    const ev = unresolvedInstallments(r, ctx, claims[i]);
    // unresolvedInstallments reads the cliff, not the committed start's absence
    // assumptions, so a committed floor's disclosures (via `disclosuresOf`) have
    // to be surfaced here or they'd vanish from resolution.pending and the
    // absence-assumption disclosure. (Moot in the all-void rollup below, which
    // ignores `blockers` — a wholly-dead program has no live floor to disclose for.)
    blockers.push(...disclosuresOf(r.start));
    // EMPTY only comes back from the fully-resolved paths. Those RESOLVED tranches
    // are dropped there; collect the resolution so the resolved producer can
    // materialize them. (A vacuous 0-occurrence statement is also empty — treating
    // it as live keeps it out of the void rollup, the safe direction.)
    if (ev.installments.length === 0) {
      resolvedResolutions.push({ r, order: i + 1 });
    }
    for (const inst of ev.installments) {
      if (inst.state !== "RESOLVED") symbolic.push(inst);
    }
    blockers.push(...ev.blockers);
  });

  // Lossless rollup: collapse to `impossible` only when every portion is void.
  // A mix stays `unresolved`, where the leaf-level IMPOSSIBLE installments still
  // carry each dead portion's truth. When every portion is void, every symbolic
  // installment is IMPOSSIBLE (so the cast holds) and the blockers are exactly the
  // records' IMPOSSIBLE blockers — typed, no cast needed.
  if (resolutions.length > 0 && resolutions.every(isVoid)) {
    const impossibleBlockers: ImpossibleBlocker[] = [];
    for (const r of resolutions) {
      if (r.start.state === "IMPOSSIBLE")
        impossibleBlockers.push(...r.start.blockers);
      else if (r.cliff.state === "IMPOSSIBLE")
        impossibleBlockers.push(...r.cliff.blockers);
    }
    return {
      verdict: {
        kind: "impossible",
        installments: symbolic as ImpossibleInstallment[],
        blockers: impossibleBlockers,
      },
      // No dated rows; every void statement draws its claim as one IMPOSSIBLE
      // tranche, so the partition ties at the claimed total, not 0.
      contributions: buildStatementContributions(resolutions, [], claims, ctx),
    };
  }

  // A mixed program is still unresolved, but its projection includes the resolved
  // siblings' dated tranches (sorted) ahead of the dateless symbolic ones.
  const alloc = resolvedResolutions.length
    ? allocateResolutions(resolvedResolutions, ctx)
    : { installments: [], contributions: [] };
  return {
    verdict: {
      kind: "unresolved",
      installments: [...alloc.installments, ...symbolic],
      blockers,
    },
    contributions: buildStatementContributions(
      resolutions,
      alloc.contributions,
      claims,
      ctx,
    ),
  };
};

/** Map a non-template build to its verdict and per-statement partition. */
export const classify = (
  build: Extract<TemplateBuild, { ok: false }>,
): ClassifyResult =>
  build.why === "unresolved" ? unresolvedArm(build) : eventsArm(build);
