// The resolver/classifier's output contract.
//
// extended.resolve(program, runtime) maps one DSL program to exactly one verdict:
//   template     resolves and fits canonical's one-template shape (the best case).
//   events       resolves to dated amounts but doesn't fit a template; pending
//                sibling portions ride along symbolically, with blockers.
//   unresolved   can't be materialized yet (unfired event), still satisfiable.
//   impossible   every portion is void — no witness assignment can ever resolve it.
//                The lossless rollup of leaf-level IMPOSSIBLE: emitted only when
//                nothing is merely pending and nothing is already resolving.

import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/types";
import type {
  Blocker,
  Finding,
  ImpossibleBlocker,
  ImpossibleInstallment,
  Installment,
  NonTemplateReason,
  ResolvedInstallment,
  SourceMap,
  UnresolvedInstallment,
} from "@vestlang/types";

// One statement's slice of the single headline allocation: the integer shares it
// contributed, grant-date-coalesced into the per-clause DISPLAY shape. Seeded over
// the whole program — exactly one per program-order statement, even when a
// statement contributes nothing (`installments: []`), so the chain-group rollup
// emits one breakdown entry per clause. A statement is either dated (its
// ResolvedInstallments) or symbolic (its pending / void tranches), never both, and
// the slices together sum to the headline by construction. Carries NO blockers —
// those ride the separate per-clause channel in the pipeline.
export interface StatementContribution {
  statementOrder: number; // 1-based program order
  installments: Installment[];
}

export type ResolveVerdict =
  | {
      kind: "template";
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      totalShares: number;
      // Externalized combinator gates: `event_id → { definition }`. Empty unless
      // a synthetic event was minted.
      sourceMap: SourceMap;
      // The dated tranches, allocated once off the shared expansion (so they're
      // byte-identical to core.compile). assemble spreads these ahead of the
      // pending ones instead of re-running compileToInstallments.
      installments: ResolvedInstallment[];
      // Pending witnesses (unfired atomic EVENT starts; unresolved synthetic-event
      // combinators). Advisory under a `template` verdict; the program is a valid
      // template regardless.
      blockers: Blocker[];
      // Symbolic UNRESOLVED installments for the pending EVENT-based statements
      // (PENDING_EVENT / SYNTHETIC_EVENT starts) — the share claims core.compile
      // will skip because there's no firing yet. Parallels the events arm's
      // symbolic ride-along; empty when every statement is dated.
      pendingInstallments: UnresolvedInstallment[];
    }
  | {
      kind: "events";
      // Dated tranches from the resolved portions, plus symbolic (UNRESOLVED)
      // ones for any sibling still waiting on an event — a pending portion's
      // shares stay accounted for even when the dated part forced this arm.
      installments: Installment[];
      // The pending siblings' witnesses. Empty when every portion resolved.
      blockers: Blocker[];
      reason: NonTemplateReason;
    }
  | {
      kind: "unresolved";
      // May carry RESOLVED tranches from fully-resolved siblings alongside the
      // symbolic (UNRESOLVED/IMPOSSIBLE) ones — a mixed program is unresolved but
      // still projects its resolved portion.
      installments: Installment[];
      blockers: Blocker[];
    }
  | {
      kind: "impossible";
      installments: ImpossibleInstallment[];
      blockers: ImpossibleBlocker[];
    };

// What `classify` actually produces: the non-template arms. A classified build
// failed the template fit by construction, so `template` is off the table.
export type ClassifiedVerdict = Exclude<ResolveVerdict, { kind: "template" }>;

// The verdict plus what the resolver learned about the schedule as a whole,
// independent of which arm it landed in: the allocation `findings`
// (over-/under-allocation) and the per-statement `contributions` (the partition of
// the headline allocation the breakdown is built from). Both sit on the wrapper,
// not in each arm, because they describe the schedule as written. `findings` ride
// onward onto EvaluatedSchedule; `contributions` ride out to the recovery outcome
// and the pipeline, never onto a stored/wire shape.
export type ResolveResult = ResolveVerdict & {
  findings: Finding[];
  contributions: StatementContribution[];
};
