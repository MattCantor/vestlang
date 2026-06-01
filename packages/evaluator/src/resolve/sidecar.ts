// Sidecar persistence (Phase 5): the ship vehicle for a Case-2 artifact.
//
// Case 2 (Phase 3) lowers a combinator-over-anchors start into a `template` by
// externalizing the gate as a grant-scoped synthetic event (`evt_<n>`) plus a
// source map (`event_id → { definition, label? }`). The template + runtime are
// ordinary OCF canonical objects; the source map is vestlang-specific meaning
// that canonical can't hold today.
//
// Rather than change the canonical schema, this module persists the source map
// OUT-OF-BAND as the OCF-sanctioned "separate mapping table that links OCF object
// IDs to your custom data" (OCF Design Patterns, "Don't Add Additional Properties
// to OCF") — keyed by the synthetic `event_id`, under an interim short `vestlang`
// namespace key (Part V). This is zero-schema-change and conformant today:
//   - a vestlang-BLIND consumer sees only valid canonical (a template gated on an
//     opaque, not-yet-fired event) and ignores the sidecar entirely;
//   - a vestlang-AWARE consumer reads the sidecar back and re-resolves it through
//     `rehydrate`.
//
// The synthetic id is only ever CARRIED through here, never recomputed (Part III —
// "the id is persisted and read, never re-derived"), so the round-trip is lossless.

import type { EvaluationContextInput, SourceMap } from "@vestlang/types";
import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/types";
import { rehydrate, type RehydrateResult } from "./rehydrate.js";

/**
 * The interim short namespace key for vestlang's sidecar (Part V). The framework
 * rule is owned, resolvable URLs (e.g. `vesting.vestlang.dev/v1`); until that
 * registry exists, the sidecar uses this short key. Kept as a named constant so
 * the eventual swap is one line.
 */
export const VESTLANG_SIDECAR_NAMESPACE = "vestlang";

/**
 * The OCF-sanctioned separate mapping table: a namespaced bag whose `vestlang`
 * key holds the source map. Lives entirely OUTSIDE the canonical OCF objects, so
 * it imposes no schema change on them.
 */
export interface Sidecar {
  [VESTLANG_SIDECAR_NAMESPACE]: SourceMap;
}

/**
 * A persisted Case-2 artifact: the canonical OCF objects (template + runtime) plus
 * the out-of-band `sidecar`. The sidecar is OPTIONAL by design — a consumer may
 * drop it, leaving a valid-but-opaque template (the synthetic events become
 * un-evaluatable milestones; the documented caveat, Part IV).
 */
export interface PersistedArtifact {
  template: VestingScheduleTemplate;
  runtime: VestingRuntime;
  sidecar?: Sidecar;
}

/**
 * Emit the sidecar from a `template`-arm source map. An EMPTY source map (a plain
 * time-based or atomic-event template, no synthetic events) emits NO sidecar —
 * there is nothing to carry out-of-band.
 */
export const toSidecar = (sourceMap: SourceMap): Sidecar | undefined =>
  Object.keys(sourceMap).length === 0
    ? undefined
    : { [VESTLANG_SIDECAR_NAMESPACE]: sourceMap };

/**
 * Read the source map back from a (possibly absent or dropped) sidecar. A missing
 * sidecar → `{}`: rehydration then computes no synthetic witnesses, leaving the
 * opaque template intact.
 */
export const fromSidecar = (sidecar?: Sidecar): SourceMap =>
  sidecar?.[VESTLANG_SIDECAR_NAMESPACE] ?? {};

/**
 * Bundle a `template`-arm artifact into its persisted form. This is also the
 * WRITE side after rehydration: re-bundle the frozen template + sidecar with the
 * witness-updated runtime. Ids are carried verbatim, never recomputed.
 */
export const toPersisted = (artifact: {
  template: VestingScheduleTemplate;
  runtime: VestingRuntime;
  sourceMap: SourceMap;
}): PersistedArtifact => {
  const sidecar = toSidecar(artifact.sourceMap);
  return {
    template: artifact.template,
    runtime: artifact.runtime,
    ...(sidecar ? { sidecar } : {}),
  };
};

/**
 * The ship vehicle "read template + sidecar → rehydrate": recover the source map
 * from the sidecar and re-resolve its definitions against the world's named-event
 * firings, merging the computed witnesses into the frozen runtime. A dropped
 * sidecar simply yields no synthetic witnesses.
 */
export const rehydratePersisted = (
  persisted: PersistedArtifact,
  ctxInput: EvaluationContextInput,
): RehydrateResult =>
  rehydrate(
    persisted.template,
    fromSidecar(persisted.sidecar),
    persisted.runtime,
    ctxInput,
  );
