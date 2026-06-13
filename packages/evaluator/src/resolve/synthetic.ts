// The reserved namespace for synthetic ("stand-in") event ids. The colon is the
// load-bearing part: the DSL Ident rule (packages/dsl/src/grammar/40-anchors.peggy)
// excludes it, so a user-authored event name can never equal a synthetic id. The
// character lives here alone, so swapping it later is a one-line change.
const SYNTHETIC_EVENT_ID_PREFIX = "evt:";

export const syntheticEventId = (ordinal: number): string =>
  `${SYNTHETIC_EVENT_ID_PREFIX}${ordinal}`;
