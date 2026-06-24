import type {
  SourceMap,
  StoredTerms,
  VestingScheduleTemplate,
} from "@vestlang/types";
import { CONTINGENT_START_SENTINEL } from "@vestlang/utils";

// The reserved namespace for synthetic ("stand-in") sidecar ids. The colon is the
// load-bearing part: the DSL Ident rule (packages/dsl/src/grammar/40-anchors.peggy)
// excludes it, so a user-authored event name can never equal a synthetic id. The
// character lives here alone, so swapping it later is a one-line change.
const SYNTHETIC_EVENT_ID_PREFIX = "evt:";

// The single reserved key a contingent vesting start externalizes its recipe
// under. There is exactly one per template (canonical hoists one start), so it's
// a fixed name rather than a numbered scheme.
export const SYNTHETIC_START_EVENT_ID = `${SYNTHETIC_EVENT_ID_PREFIX}start`;

// A numbered synthetic id, `evt:<n>`. Cliffs are plural (one per statement), so an
// event-held cliff whose event side is richer than a bare id mints one of these,
// deduped by rendered recipe (lower.ts owns the counter + map). The single-key
// `evt:start` scheme suffices only for the one hoisted start.
export const syntheticEventId = (ordinal: number): string =>
  `${SYNTHETIC_EVENT_ID_PREFIX}${ordinal}`;

// A synthetic id is one of the reserved forms: the start key `evt:start`, or a
// numbered `evt:<n>` (a digits-only suffix). A user-authored event name never
// matches (the Ident rule excludes the colon), and — closing AC 8 — neither does
// a stray `evt:<garbage>` whose suffix is neither `start` nor a run of digits, so
// a hand-edited artifact can't smuggle a tampered key past the namespace guard.
// (`evt:<n>` is no longer minted — starts route through `evt:start` — but the
// guard still recognizes it so an artifact carrying one stays loadable.) Module-
// local: the only consumer is the partition scan below.
export const isSyntheticEventId = (id: string): boolean => {
  if (!id.startsWith(SYNTHETIC_EVENT_ID_PREFIX)) return false;
  const suffix = id.slice(SYNTHETIC_EVENT_ID_PREFIX.length);
  return suffix === "start" || /^[0-9]+$/.test(suffix);
};

// Raised when a persisted artifact's sidecar carries a source-map key outside the
// reserved synthetic namespace. Such a key aliases a real user event: on reload it
// would re-resolve a tampered definition and shadow the user's genuine firing. The
// artifact is untrusted (it lives in external storage and may be hand-edited), so
// this signals it's been tampered with, not a transient pending state.
//
// Discriminated by the literal `name` tag, NOT `instanceof`: the evaluator can be
// loaded across module realms (a CJS consumer alongside this ESM build), where
// `instanceof` against a duplicated class silently misses. Use
// `isSyntheticNamespaceError` and key on the tag.
export class SyntheticNamespaceError extends Error {
  readonly name = "SyntheticNamespaceError";
  // The offending key, so the refusal can name it.
  readonly event_id: string;

  constructor(eventId: string) {
    super(
      `Source-map key "${eventId}" is outside the reserved synthetic namespace.`,
    );
    this.event_id = eventId;
  }
}

export const isSyntheticNamespaceError = (
  e: unknown,
): e is SyntheticNamespaceError =>
  e instanceof Error && e.name === "SyntheticNamespaceError";

// The first source-map key that isn't in the reserved namespace, or undefined if
// every key is reserved. The shared primitive behind both partition checks below,
// so the save and reload paths can't drift on what "reserved" means.
const firstNonReservedKey = (sourceMap: SourceMap): string | undefined =>
  Object.keys(sourceMap).find((key) => !isSyntheticEventId(key));

// Save-path tripwire: assert the partition + the contingent-start marker invariant
// hold before persisting.
//
// Three halves, all checkable only on save, where the template, runtime, and
// source map are complete by construction (lower.ts just produced them):
//   (a) every source-map key is a reserved synthetic id;
//   (b) the contingent-start marker is consistent: a CONTINGENT_START_SENTINEL
//       startDate has a matching `evt:start` recipe, and an `evt:start` recipe has
//       the sentinel startDate. One without the other is a damaged artifact (the
//       sentinel would project nothing / the recipe could never be applied);
//   (c) no statement's `event_condition` points at a reserved `evt:<n>` id with no
//       matching source-map recipe (a dangling synthetic pointer — the recipe was
//       lost, so the reload could never re-resolve the hold). This is the original
//       pre-#372 masquerade check, retargeted from the (now DATE-only) start slot
//       to the cliff's `event_condition`. Dangling-pointer only: an orphan recipe
//       no statement references is NOT a violation — the reverse direction is
//       deliberately unenforced.
//
// A freshly-lowered artifact can only violate any half through a vestlang lowering
// regression — no user DSL can trigger it (Ident excludes the colon; the start
// recipe always mints `evt:start`; cliff synthetics always mint a recipe alongside
// the id). So a violation is a programmer error: this throws a plain `Error` (NOT
// the tagged namespace error), which the persist orchestrator does not catch — it
// propagates as the bug it is rather than dressing up as a user refusal. The three
// halves carry distinct, stable message substrings so a caller can tell them apart.
export const assertSavePartition = (
  template: VestingScheduleTemplate,
  runtime: StoredTerms,
  sourceMap: SourceMap,
): void => {
  const stray = firstNonReservedKey(sourceMap);
  if (stray !== undefined) {
    throw new Error(
      `Persist invariant violated: source-map key "${stray}" is outside the reserved namespace.`,
    );
  }

  const hasSentinelStart = runtime.startDate === CONTINGENT_START_SENTINEL;
  const hasStartRecipe = Object.hasOwn(sourceMap, SYNTHETIC_START_EVENT_ID);
  if (hasSentinelStart !== hasStartRecipe) {
    throw new Error(
      hasSentinelStart
        ? `Persist invariant violated: the contingent-start sentinel is present but the "${SYNTHETIC_START_EVENT_ID}" recipe is missing.`
        : `Persist invariant violated: an "${SYNTHETIC_START_EVENT_ID}" recipe is present but the startDate is not the contingent-start sentinel.`,
    );
  }

  for (const stmt of template.statements) {
    const eventId = stmt.event_condition?.event_id;
    if (
      eventId !== undefined &&
      isSyntheticEventId(eventId) &&
      !Object.hasOwn(sourceMap, eventId)
    ) {
      throw new Error(
        `Persist invariant violated: statement event_condition "${eventId}" in the reserved namespace has no source-map recipe.`,
      );
    }
  }
};

// Reload-path check: the firing-independent half of the partition. Every present
// source-map key must be reserved; the first stray key throws the tagged
// SyntheticNamespaceError so the pipeline can refuse cleanly. Scanned over the raw
// key set (D6: before any template filter) — a tampered key with no matching
// template statement is still a violation and must not slip through.
//
// The masquerade half (b) is NOT run on reload: a dropped sidecar legitimately
// empties the source map, so a definition-dropped synthetic (`evt:1` template
// statement, no key) would false-positive there.
export const assertReloadKeysReserved = (sourceMap: SourceMap): void => {
  const stray = firstNonReservedKey(sourceMap);
  if (stray !== undefined) throw new SyntheticNamespaceError(stray);
};
