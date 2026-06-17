import type { SourceMap, VestingScheduleTemplate } from "@vestlang/types";

// The reserved namespace for synthetic ("stand-in") event ids. The colon is the
// load-bearing part: the DSL Ident rule (packages/dsl/src/grammar/40-anchors.peggy)
// excludes it, so a user-authored event name can never equal a synthetic id. The
// character lives here alone, so swapping it later is a one-line change.
const SYNTHETIC_EVENT_ID_PREFIX = "evt:";

export const syntheticEventId = (ordinal: number): string =>
  `${SYNTHETIC_EVENT_ID_PREFIX}${ordinal}`;

// A synthetic id carries the reserved prefix; a user-authored event name never
// can (the Ident rule excludes the colon). Rehydration uses this to tell a
// dropped-sidecar synthetic — which stays opaque — apart from a bare named event.
export const isSyntheticEventId = (id: string): boolean =>
  id.startsWith(SYNTHETIC_EVENT_ID_PREFIX);

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

// Save-path tripwire: assert the namespace partition holds before persisting.
//
// Two halves, both checkable only on save, where the source map is complete by
// construction (lower.ts just produced it):
//   (a) every source-map key is a reserved synthetic id;
//   (b) no template EVENT statement claims a reserved id without a matching
//       source-map entry (a named event masquerading as a synthetic).
//
// A freshly-lowered source map can only violate this through a vestlang lowering
// regression — no user DSL can trigger it (Ident excludes the colon; synthetics
// always mint `evt:<n>`). So a violation is a programmer error: this throws a plain
// `Error` (NOT the tagged namespace error), which the persist orchestrator does not
// catch — it propagates as the bug it is rather than dressing up as a user refusal.
// The two halves carry distinct, stable message substrings so a caller can tell
// them apart.
export const assertSavePartition = (
  template: VestingScheduleTemplate,
  sourceMap: SourceMap,
): void => {
  const stray = firstNonReservedKey(sourceMap);
  if (stray !== undefined) {
    throw new Error(
      `Persist invariant violated: source-map key "${stray}" is outside the reserved namespace.`,
    );
  }

  for (const stmt of template.statements) {
    if (stmt.vesting_base.type !== "EVENT") continue;
    const eventId = stmt.vesting_base.event_id;
    if (isSyntheticEventId(eventId) && !Object.hasOwn(sourceMap, eventId)) {
      throw new Error(
        `Persist invariant violated: template event "${eventId}" in the reserved namespace has no source-map entry.`,
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
