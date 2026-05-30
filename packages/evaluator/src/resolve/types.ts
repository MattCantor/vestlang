// The resolver/classifier's output contract.
//
// extended.resolve(program, runtime) → ResolveResult maps one DSL program to
// exactly one interchange-fidelity level:
//   - template   — resolves AND fits canonical's one-template shape (best).
//   - events     — resolves to concrete dated amounts but doesn't fit a template.
//   - unresolved — can't be materialized yet (unfired event) or contradictory.

import type {
  VestingRuntime,
  VestingScheduleTemplate,
} from "@vestlang/core";
import type {
  Blocker,
  ImpossibleInstallment,
  ResolvedInstallment,
  UnresolvedInstallment,
} from "@vestlang/types";

/** Why a resolved program could not be a single canonical template. */
export type NonTemplateReason =
  // Two independent DATE-anchored time grids live at once (fidelity-ladder case 3).
  // Carta models these as separate grants, so they can't be one template.
  | { kind: "OVERLAPPING_ABSOLUTE_STARTS"; detail?: string }
  // An event-anchored cliff — Carta has no event anchor on the cliff field.
  | { kind: "EVENT_CLIFF"; eventId: string; detail?: string }
  // A loaded (non-cumulative) allocation mode — the interchange carries no
  // allocation field, so loaded splits can't be a canonical template.
  | { kind: "LOADED_ALLOCATION"; mode: string; detail?: string };

/** Amount-carrying installments with symbolic/absent dates (the unresolved arm). */
export type SymbolicInstallment = UnresolvedInstallment | ImpossibleInstallment;

export type ResolveResult =
  | {
      kind: "template";
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      totalShares: number;
    }
  | {
      kind: "events";
      installments: ResolvedInstallment[];
      reason: NonTemplateReason;
    }
  | {
      kind: "unresolved";
      symbolic: SymbolicInstallment[];
      blockers: Blocker[];
    };
