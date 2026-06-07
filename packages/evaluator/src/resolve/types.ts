// The resolver/classifier's output contract.
//
// extended.resolve(program, runtime) maps one DSL program to exactly one verdict:
//   template     resolves and fits canonical's one-template shape (the best case).
//   events       resolves to concrete dated amounts but doesn't fit a template.
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
  ResolvedInstallment,
  SourceMap,
} from "@vestlang/types";

/** Why a resolved program could not be a single canonical template. */
export type NonTemplateReason =
  // Two independent DATE-anchored time grids live at once. Carta models these as
  // separate grants, so they can't be one template.
  | { kind: "OVERLAPPING_ABSOLUTE_STARTS"; detail?: string }
  // An event-anchored cliff; Carta has no event anchor on the cliff field.
  | { kind: "EVENT_CLIFF"; eventId: string; detail?: string };

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
    }
  | {
      kind: "events";
      installments: ResolvedInstallment[];
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

// The verdict plus any findings the resolver accumulated (over-allocation, for
// now). Carried on the wrapper rather than duplicated into each arm — findings
// are about the resolution attempt as a whole, not about which verdict it
// reached — and threaded onward onto EvaluatedSchedule the same way.
export type ResolveResult = ResolveVerdict & { findings: Finding[] };
