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
