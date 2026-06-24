// Event-id case near-miss advisory.
//
// Event ids match case-sensitively while DSL keywords don't, so a firing keyed
// `ipo` never satisfies a gate that references `IpO` — the schedule just pends,
// silently. This pass flags the likely typo: a referenced id with no exact firing
// but a case-only twin among the firings the caller supplied. It rides the
// resolution arm only (it needs the firing map, which the interchange context
// never carries), and it's purely additive — matching and resolution are
// unchanged, the grant still pends; we only add the warning.

import { walk } from "@vestlang/walk";
import type { Finding, OCTDate, Program } from "@vestlang/types";

// Every event id written in the program, deduped. We walk each statement —
// `Program` is a bare `Statement[]`, not a walkable node — and let `@vestlang/walk`
// enumerate the edges, so a gate anchor, a combinator arm, or a cliff event are all
// reached without us hand-tracking the node shape. Synthetic `evt:*` ids are minted
// during lowering, not present in the normalized AST, so the walk sees only
// user-written ids.
const referencedEventIds = (program: Program): Set<string> => {
  const ids = new Set<string>();
  for (const stmt of program) {
    walk(stmt, (node) => {
      if (node.type === "EVENT") ids.add(node.value);
    });
  }
  return ids;
};

// A firing key that differs from `refId` only by case, when no exact firing exists.
// `.find` returns the first such key; if two keys both case-match (`ipo` and `IPO`),
// naming the first is deterministic and enough — the message points at a near-twin,
// it doesn't enumerate them.
const caseTwin = (refId: string, firingKeys: string[]): string | undefined => {
  if (firingKeys.includes(refId)) return undefined;
  const lower = refId.toLowerCase();
  return firingKeys.find((k) => k.toLowerCase() === lower);
};

// One warning per distinct referenced id whose firing exists only under a different
// case. `firings` is the as-supplied input map (`ctxInput.events`): we read its raw
// keys, including named-but-unfired entries, since a `{ ipo: undefined }` near-twin
// is still a case miss worth flagging. No `path` — the warning is program-wide and
// deduped per id, with no single canonical node to point at.
export const eventCaseFindings = (
  program: Program,
  firings: Record<string, OCTDate | undefined>,
): Finding[] => {
  const firingKeys = Object.keys(firings);
  const findings: Finding[] = [];
  for (const referenced of referencedEventIds(program)) {
    const fired = caseTwin(referenced, firingKeys);
    if (fired !== undefined) {
      findings.push({
        kind: "event-firing-case-mismatch",
        severity: "warning",
        referenced,
        fired,
      });
    }
  }
  return findings;
};
