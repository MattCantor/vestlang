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
  OCTDate,
  SourceMap,
  UnresolvedInstallment,
} from "@vestlang/types";

export type ResolveVerdict =
  | {
      kind: "template";
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      totalShares: number;
      // Externalized combinator gates: `event_id → { definition }`. Empty unless
      // a synthetic event was minted.
      sourceMap: SourceMap;
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

// The verdict plus what the resolver learned about the schedule as a whole,
// independent of which arm it landed in:
//   - `findings`  — allocation problems (over-/under-allocation).
//   - `cliffDate` — the schedule's earliest placeable cliff date, or null.
// Both sit on the wrapper, not in each arm, because they describe the schedule as
// written, and both ride onward onto EvaluatedSchedule the same way.
export type ResolveResult = ResolveVerdict & {
  findings: Finding[];
  cliffDate: OCTDate | null;
};
