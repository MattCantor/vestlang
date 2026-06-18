// Sidecar persistence: the carrier for a template that holds synthetic events.
//
// Lowering a combinator-over-anchors start into a `template` externalizes the gate
// as a grant-scoped synthetic event (`evt:<n>`) plus a source map
// (`event_id` to `{ definition }`). The template and runtime are ordinary
// OCF canonical objects; the source map is vestlang-specific meaning that canonical
// can't hold today.
//
// Rather than change the canonical schema, this module persists the source map
// out-of-band, as the OCF-sanctioned "separate mapping table that links OCF object
// IDs to your custom data" (OCF Design Patterns, "Don't Add Additional Properties
// to OCF"). It is keyed by the synthetic `event_id`, under an interim short
// `vestlang` namespace key. This needs no schema change and is conformant today:
//   - a vestlang-blind consumer sees only valid canonical (a template gated on an
//     opaque, not-yet-fired event) and ignores the sidecar entirely;
//   - a vestlang-aware consumer reads the sidecar back and re-resolves it through
//     `rehydrate`.
//
// The synthetic id is only ever carried through here, never recomputed (persisted
// and read, never re-derived), so the round-trip is lossless.

import type {
  ResolutionContextInput,
  SourceMap,
  SourceMapEntry,
} from "@vestlang/types";
import type { StoredTerms, VestingScheduleTemplate } from "@vestlang/types";
import { rehydrate, type RehydrateResult } from "./rehydrate.js";
import { assertSavePartition } from "./synthetic.js";

/**
 * The interim short namespace key for vestlang's sidecar. The framework rule is
 * owned, resolvable URLs (e.g. `vesting.vestlang.dev/v1`); until that registry
 * exists, the sidecar uses this short key. Kept as a named constant so the
 * eventual swap is one line.
 */
export const VESTLANG_SIDECAR_NAMESPACE = "vestlang";

/**
 * The OCF-sanctioned separate mapping table: a namespaced bag whose `vestlang`
 * key holds the source map. It lives entirely outside the canonical OCF objects,
 * so it imposes no schema change on them.
 */
export interface Sidecar {
  [VESTLANG_SIDECAR_NAMESPACE]: SourceMap;
}

/**
 * A persisted artifact: the canonical OCF objects (template + runtime) plus the
 * out-of-band `sidecar`. The sidecar is optional by design. A consumer may drop
 * it, leaving a valid-but-opaque template; the synthetic events then become
 * un-evaluatable milestones, a deliberate tradeoff of the out-of-band scheme.
 *
 * `runtime` is `StoredTerms`, not `VestingRuntime`: a persisted artifact is
 * firing-invariant by construction, so it cannot carry `eventFirings` (the type
 * makes that unrepresentable). Witnesses are re-derived from the world on every
 * reload via `rehydrate`, never baked into the stored artifact.
 */
export interface PersistedArtifact {
  template: VestingScheduleTemplate;
  runtime: StoredTerms;
  sidecar?: Sidecar;
}

/**
 * Emit the sidecar from a `template`-arm source map. An empty source map (a plain
 * time-based or atomic-event template, no synthetic events) emits no sidecar at
 * all, since there is nothing to carry out-of-band.
 */
export const toSidecar = (sourceMap: SourceMap): Sidecar | undefined =>
  Object.keys(sourceMap).length === 0
    ? undefined
    : { [VESTLANG_SIDECAR_NAMESPACE]: sourceMap };

/**
 * Read the source map back from a (possibly absent or dropped) sidecar. A missing
 * sidecar yields an empty map, so rehydration then computes no synthetic witnesses,
 * leaving the opaque template intact. The map is always null-proto — including the
 * populated branch, the one a key colliding with `Object.prototype` would live on —
 * so rehydrate's `Object.hasOwn` membership check reads it cleanly.
 */
export const fromSidecar = (sidecar?: Sidecar): SourceMap =>
  Object.assign(
    Object.create(null) as Record<string, SourceMapEntry>,
    sidecar?.[VESTLANG_SIDECAR_NAMESPACE],
  );

/**
 * Bundle a `template`-arm artifact into its persisted form. This is also the
 * write side after rehydration: re-bundle the frozen template and sidecar with the
 * witness-updated runtime. Ids are carried verbatim, never recomputed.
 */
export const toPersisted = (artifact: {
  template: VestingScheduleTemplate;
  runtime: StoredTerms;
  sourceMap: SourceMap;
}): PersistedArtifact => {
  // Tripwire: the synthetic/named partition must hold before this becomes a
  // durable artifact. A freshly-lowered map can only break it via a lowering bug,
  // so this throws a plain Error (not a user refusal) and isn't caught downstream.
  assertSavePartition(artifact.template, artifact.sourceMap);
  const sidecar = toSidecar(artifact.sourceMap);
  return {
    template: artifact.template,
    runtime: artifact.runtime,
    ...(sidecar ? { sidecar } : {}),
  };
};

/**
 * The read path: recover the source map from the sidecar and re-resolve its
 * definitions against the world's named-event firings, merging the computed
 * witnesses into the frozen runtime. A dropped sidecar simply yields no synthetic
 * witnesses.
 */
export const rehydratePersisted = (
  persisted: PersistedArtifact,
  ctxInput: ResolutionContextInput,
): RehydrateResult =>
  rehydrate(
    persisted.template,
    fromSidecar(persisted.sidecar),
    persisted.runtime,
    ctxInput,
  );
