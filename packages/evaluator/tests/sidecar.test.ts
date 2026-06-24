// Sidecar persistence. A stored artifact (template + runtime) with a contingent
// start carries its `evt:start` recipe out-of-band in a namespaced `vestlang`
// sidecar — the OCF-sanctioned separate mapping table. The artifact must survive a
// real serialization boundary (JSON) and rehydrate with the recipe re-resolving to
// the real start; dropping the sidecar of a contingent artifact is a damaged
// artifact (the start can't be re-derived); and a plain dated template with no
// contingent start emits no sidecar at all.

import { describe, it, expect } from "vitest";
import type { Amount, AsOfContextInput, Statement } from "@vestlang/types";
import {
  assertValidVestingScheduleTemplate,
  compileToInstallments,
} from "@vestlang/core";
import { CONTINGENT_START_SENTINEL } from "@vestlang/utils";
import { evaluateStatement } from "../src/evaluate";
import {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  isRehydrateMissingStartMarkerError,
  type PersistedArtifact,
} from "../src/resolve/index";
import type { SourceMap, VestingScheduleTemplate } from "@vestlang/types";
import {
  makeSingletonNode,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
} from "./helpers";

const ctxInput = (
  overrides: Partial<AsOfContextInput> = {},
): AsOfContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 100000,
  asOf: "2035-01-01",
  ...overrides,
});

const portion = (numerator: number, denominator: number): Amount => ({
  type: "PORTION",
  numerator,
  denominator,
});

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

// `100% MONTHLY OVER 48 FROM LATER OF(+12mo, EVENT "ipo")`: `+12mo` is the
// grantDate system anchor (→ DATE), `EVENT "ipo"` the genuine condition that makes
// this a contingent start, externalized under the reserved `evt:start` key.
const stageAStmt = (): Statement => ({
  type: "STATEMENT",
  amount: portion(1, 1),
  expr: {
    type: "SCHEDULE",
    vesting_start: {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseGrantDate(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    },
    periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
  },
});

// The stored artifact (IPO unfired): the firing-invariant `interchange` `template`
// arm — a DATE statement on the contingent-start sentinel, a firing-free
// StoredTerms runtime, and the source map with the one `evt:start` recipe — which
// is what persist actually stores.
const storedArtifact = () => {
  const { interchange } = evaluateStatement(
    stageAStmt(),
    ctxInput({ grantQuantity: 4800 }),
  );
  if (interchange.status !== "template")
    throw new Error(`expected template, got ${interchange.status}`);
  return {
    template: interchange.template,
    sourceMap: interchange.sourceMap,
    runtime: interchange.runtime,
  };
};

// A plain time-based template with NO contingent start: `100% MONTHLY OVER 48 FROM
// EVENT "grantDate"` — a pure system anchor, no genuine event, so no `evt:start`.
const plainStmt = (): Statement => ({
  type: "STATEMENT",
  amount: portion(1, 1),
  expr: {
    type: "SCHEDULE",
    vesting_start: makeSingletonNode(makeVestingBaseGrantDate()),
    periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
  },
});

describe("sidecar — round-trips through JSON + rehydration with the recipe preserved", () => {
  it("carries the evt:start recipe verbatim from emit to re-derived start", () => {
    const stored = storedArtifact();
    // The stored template is the contingent placeholder: the start sits on the sentinel.
    expect(stored.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(Object.keys(stored.sourceMap)).toEqual(["evt:start"]);

    // Emit: bundle the canonical objects + the namespaced sidecar.
    const persisted = toPersisted(stored);
    expect(persisted.sidecar?.[VESTLANG_SIDECAR_NAMESPACE]).toHaveProperty(
      "evt:start",
    );

    // A real serialization boundary: store as JSON, read it back.
    const reread: PersistedArtifact = JSON.parse(JSON.stringify(persisted));
    expect(Object.keys(fromSidecar(reread.sidecar))).toEqual(["evt:start"]);

    // Read template + sidecar → rehydrate with the IPO fired. The recipe resolves
    // to the LATER OF (max of grant+12mo and the IPO firing) and substitutes into
    // the projection-only runtime.
    const result = rehydratePersisted(
      reread,
      ctxInput({
        grantDate: "2025-01-01",
        events: { ipo: "2027-03-01" },
        asOf: "2027-06-01",
        grantQuantity: 4800,
      }),
    );
    expect(result.startToApply).toEqual({ date: "2027-03-01" });
    expect(result.runtime.startDate).toBe("2027-03-01");
    expect(result.pending).toEqual([]);
    expect(result.dead).toEqual([]);

    // The frozen template + re-derived runtime compiles to the full schedule.
    const installments = compileToInstallments(
      reread.template,
      4800,
      result.runtime,
    );
    expect(installments).toHaveLength(48);
    expect(sum(installments)).toBe(4800);

    // The stored artifact is never mutated: its startDate is still the sentinel.
    expect(reread.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
  });
});

describe("sidecar — dropping a contingent artifact's sidecar is a damaged artifact", () => {
  it("the bare template is still valid OCF, but reload refuses (start can't be re-derived)", () => {
    const stored = storedArtifact();

    // Persist, then DROP the sidecar (a vestlang-blind consumer in the pipeline).
    const dropped: PersistedArtifact = {
      template: stored.template,
      runtime: stored.runtime,
    };

    // The template is still structurally valid canonical (anchored on a real
    // far-future startDate).
    expect(() =>
      assertValidVestingScheduleTemplate(dropped.template),
    ).not.toThrow();
    expect(fromSidecar(dropped.sidecar)).toEqual({});

    // But a vestlang-aware reload detects the dropped contingency marker: the
    // sentinel startDate with no `evt:start` recipe is a damaged artifact.
    let thrown: unknown;
    try {
      rehydratePersisted(
        dropped,
        ctxInput({ events: { ipo: "2027-03-01" }, grantQuantity: 4800 }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(isRehydrateMissingStartMarkerError(thrown)).toBe(true);
  });
});

describe("sidecar — a plain dated template emits no sidecar", () => {
  it("toSidecar({}) is undefined and toPersisted omits the field", () => {
    const { interchange } = evaluateStatement(
      plainStmt(),
      ctxInput({ grantQuantity: 4800 }),
    );
    if (interchange.status !== "template")
      throw new Error(`expected template, got ${interchange.status}`);
    expect(interchange.sourceMap).toEqual({});

    expect(toSidecar(interchange.sourceMap)).toBeUndefined();
    const persisted = toPersisted(interchange);
    expect("sidecar" in persisted).toBe(false);
  });
});

// The save-path partition tripwire. The artifact a normal persist produces always
// honors the reserved-namespace partition AND the sentinel⇔`evt:start` marker
// invariant; a violation can only come from a lowering bug, so `toPersisted` throws
// a PLAIN Error (not the tagged namespace error, not a structured refusal) that the
// persist orchestrator doesn't catch. These build the violating artifacts by hand.
describe("toPersisted — save-path partition tripwire", () => {
  // A one-statement DATE template on the contingent-start sentinel.
  const sentinelTemplate = (): VestingScheduleTemplate => ({
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
      },
    ],
  });

  it("throws a plain Error naming a source-map key outside the reserved namespace (AC1)", () => {
    // A key `evt_1` is a legal user Ident, NOT in the `evt:` namespace.
    const sourceMap: SourceMap = {
      evt_1: { definition: "LATER OF(EVENT a, EVENT b)" },
    };
    let thrown: unknown;
    try {
      toPersisted({
        template: sentinelTemplate(),
        runtime: {
          grantDate: "2026-01-01",
          startDate: CONTINGENT_START_SENTINEL,
        },
        sourceMap,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    // Plain Error, NOT the tagged namespace error.
    expect((thrown as Error).name).toBe("Error");
    expect((thrown as Error).message).toContain(
      'source-map key "evt_1" is outside the reserved namespace',
    );
  });

  it("throws a plain Error, with a distinct message, when the sentinel/evt:start marker is inconsistent (AC2)", () => {
    // The runtime carries the sentinel startDate but the source map has no
    // `evt:start` recipe — the contingency marker is half-present. The keys are all
    // reserved (empty map), so AC1's half passes.
    const sourceMap: SourceMap = {};
    let thrown: unknown;
    try {
      toPersisted({
        template: sentinelTemplate(),
        runtime: {
          grantDate: "2026-01-01",
          startDate: CONTINGENT_START_SENTINEL,
        },
        sourceMap,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("Error");
    expect((thrown as Error).message).toContain("evt:start");
    // AC1 and AC2 are distinguishable by message substring.
    expect((thrown as Error).message).not.toContain(
      "outside the reserved namespace",
    );
  });

  it("does not throw for a consistent contingent artifact (sentinel + evt:start) (AC3)", () => {
    const sourceMap: SourceMap = {
      "evt:start": { definition: "LATER OF(EVENT a, EVENT b)" },
    };
    expect(() =>
      toPersisted({
        template: sentinelTemplate(),
        runtime: {
          grantDate: "2026-01-01",
          startDate: CONTINGENT_START_SENTINEL,
        },
        sourceMap,
      }),
    ).not.toThrow();
  });

  it("does not throw for a plain dated template with an empty source map (AC3)", () => {
    expect(() =>
      toPersisted({
        template: sentinelTemplate(),
        runtime: { grantDate: "2026-01-01", startDate: "2026-01-01" },
        sourceMap: {},
      }),
    ).not.toThrow();
  });

  // A dated template carrying one statement with the given event_condition.
  const conditionTemplate = (eventId: string): VestingScheduleTemplate => ({
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
        event_condition: { event_id: eventId },
      },
    ],
  });

  // AC 13: the dangling-pointer half, retargeted to event_condition. A statement
  // whose event_condition.event_id is a reserved evt:<n> id with no matching
  // source-map recipe is rejected with a PLAIN Error (an internal-bug tripwire, not
  // the tagged namespace error). Hand-built — lowering never mints this.
  it("throws a plain Error when an event_condition's evt:<n> id has no source-map recipe (AC13)", () => {
    let thrown: unknown;
    try {
      toPersisted({
        template: conditionTemplate("evt:1"),
        runtime: { grantDate: "2026-01-01", startDate: "2026-01-01" },
        sourceMap: {}, // the recipe was lost — dangling pointer
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("Error");
    expect((thrown as Error).message).toContain('event_condition "evt:1"');
    expect((thrown as Error).message).toContain("no source-map recipe");
  });

  // A bare REAL event_condition id needs no recipe — it resolves against the world,
  // so it must NOT trip the dangling-pointer check.
  it("does not throw for a bare real event_condition id with no recipe (AC13)", () => {
    expect(() =>
      toPersisted({
        template: conditionTemplate("board"),
        runtime: { grantDate: "2026-01-01", startDate: "2026-01-01" },
        sourceMap: {},
      }),
    ).not.toThrow();
  });

  // A synthetic event_condition WITH its recipe is consistent — no throw.
  it("does not throw for a synthetic event_condition backed by its recipe (AC12)", () => {
    expect(() =>
      toPersisted({
        template: conditionTemplate("evt:1"),
        runtime: { grantDate: "2026-01-01", startDate: "2026-01-01" },
        sourceMap: { "evt:1": { definition: "LATER OF(EVENT a, EVENT b)" } },
      }),
    ).not.toThrow();
  });

  // Dangling-pointer ONLY: an orphan evt:<n> recipe that no statement references is
  // NOT rejected (we don't enforce the reverse direction). It rides beside a
  // consistent contingent start so the namespace + marker halves both pass.
  it("does not reject an orphan evt:<n> recipe no statement references (AC13)", () => {
    expect(() =>
      toPersisted({
        template: sentinelTemplate(), // no event_condition references evt:7
        runtime: {
          grantDate: "2026-01-01",
          startDate: CONTINGENT_START_SENTINEL,
        },
        sourceMap: {
          "evt:start": { definition: "EVENT ipo" },
          "evt:7": { definition: "LATER OF(EVENT a, EVENT b)" },
        },
      }),
    ).not.toThrow();
  });
});
