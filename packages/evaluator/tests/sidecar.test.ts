// Sidecar persistence. A stored artifact (template + runtime) with synthetic
// events carries its source map out-of-band in a namespaced `vestlang` sidecar —
// the OCF-sanctioned separate mapping table keyed by `event_id`. The artifact
// must survive a real serialization boundary (JSON) and rehydrate with the
// synthetic id preserved verbatim; dropping the sidecar must leave a
// valid-but-opaque template; and a plain template with no synthetic events emits
// no sidecar at all.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  AsOfContextInput,
  Program,
  Statement,
} from "@vestlang/types";
import {
  assertValidVestingScheduleTemplate,
  compileToInstallments,
} from "@vestlang/core";
import { evaluateStatement } from "../src/orchestrate";
import {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  resolveInterchange,
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
// grantDate system anchor (→ DATE), `EVENT "ipo"` the genuine condition that
// earns the synthetic event.
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
// arm — the synthetic EVENT statement, a firing-free StoredTerms runtime, and the
// source map — which is what persist actually stores.
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

// A plain time-based template with NO synthetic events: `100% MONTHLY OVER 48
// FROM EVENT "grantDate"` — a pure system anchor, no genuine condition.
const plainStmt = (): Statement => ({
  type: "STATEMENT",
  amount: portion(1, 1),
  expr: {
    type: "SCHEDULE",
    vesting_start: makeSingletonNode(makeVestingBaseGrantDate()),
    periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
  },
});

// The synthetic `event_id` minted at emit — there is exactly one in Stage A.
const syntheticIdOf = (template: PersistedArtifact["template"]): string => {
  const ev = template.statements.find((s) => s.vesting_base.type === "EVENT");
  if (!ev || ev.vesting_base.type !== "EVENT")
    throw new Error("no EVENT statement");
  return ev.vesting_base.event_id;
};

describe("sidecar — round-trips through JSON + rehydration with id preserved", () => {
  it("carries the synthetic event_id verbatim from emit to witness", () => {
    const stored = storedArtifact();
    const id = syntheticIdOf(stored.template);

    // Emit: bundle the canonical objects + the namespaced sidecar.
    const persisted = toPersisted(stored);
    expect(persisted.sidecar?.[VESTLANG_SIDECAR_NAMESPACE]).toHaveProperty(id);

    // A real serialization boundary: store as JSON, read it back.
    const reread: PersistedArtifact = JSON.parse(JSON.stringify(persisted));

    // The id is the same in the template statement AND the sidecar key — carried,
    // never recomputed.
    expect(syntheticIdOf(reread.template)).toBe(id);
    expect(Object.keys(fromSidecar(reread.sidecar))).toEqual([id]);

    // Read template + sidecar → rehydrate with the IPO fired.
    const result = rehydratePersisted(
      reread,
      ctxInput({
        grantDate: "2025-01-01",
        events: { ipo: "2027-03-01" },
        asOf: "2027-06-01",
        grantQuantity: 4800,
      }),
    );

    // One witness, the same id, dated at the IPO firing.
    expect(result.runtime.eventFirings).toEqual([
      { event_id: id, date: "2027-03-01" },
    ]);
    expect(result.pending).toEqual([]);
    expect(result.dead).toEqual([]);

    // The frozen template + witnessed runtime compiles to the full schedule.
    const installments = compileToInstallments(
      reread.template,
      4800,
      result.runtime,
    );
    expect(installments).toHaveLength(48);
    expect(sum(installments)).toBe(4800);
  });
});

describe("sidecar — dropping it leaves a valid-but-opaque template", () => {
  it("rehydrates to no synthetic witness; the template is still valid OCF", () => {
    const stored = storedArtifact();
    const id = syntheticIdOf(stored.template);

    // Persist, then DROP the sidecar (a vestlang-blind consumer in the pipeline).
    const dropped: PersistedArtifact = {
      template: stored.template,
      runtime: stored.runtime,
    };

    // No source map → no synthetic witness, even with the IPO fired.
    expect(fromSidecar(dropped.sidecar)).toEqual({});
    const result = rehydratePersisted(
      dropped,
      ctxInput({
        grantDate: "2025-01-01",
        events: { ipo: "2027-03-01" },
        grantQuantity: 4800,
      }),
    );
    expect(result.runtime.eventFirings ?? []).toEqual([]);

    // The template is still valid canonical, the opaque event_id intact, and it
    // compiles to nothing for that statement (a pending, un-evaluatable milestone).
    expect(() =>
      assertValidVestingScheduleTemplate(dropped.template),
    ).not.toThrow();
    expect(syntheticIdOf(dropped.template)).toBe(id);
    expect(
      compileToInstallments(dropped.template, 4800, result.runtime),
    ).toEqual([]);
  });
});

describe("sidecar — a template with no synthetic events emits no sidecar", () => {
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

// A grant whose program mixes a stand-in event (the `LATER OF(a, b)` half, which
// the lowering can't store directly and so externalizes) with a user event the
// author named `evt_1`. The stand-in's id lives in the `evt:<n>` namespace, which
// no DSL identifier can spell, so the two never share a string and the persisted
// artifact keeps them distinct.
describe("sidecar — a stand-in event and a user `evt_1` stay distinct through persistence", () => {
  // `1/2 FROM LATER OF(EVENT a, EVENT b) ... PLUS 1/2 FROM EVENT evt_1 ...`.
  const collisionProgram = (): Program => [
    {
      type: "STATEMENT",
      amount: portion(1, 2),
      expr: {
        type: "SCHEDULE",
        vesting_start: {
          type: "NODE_LATER_OF",
          items: [
            makeSingletonNode(makeVestingBaseEvent("a")),
            makeSingletonNode(makeVestingBaseEvent("b")),
          ],
        },
        periodicity: { type: "MONTHS", length: 4, occurrences: 4 },
      },
    },
    {
      type: "STATEMENT",
      amount: portion(1, 2),
      expr: {
        type: "SCHEDULE",
        vesting_start: makeSingletonNode(makeVestingBaseEvent("evt_1")),
        periodicity: { type: "MONTHS", length: 4, occurrences: 4 },
      },
    },
  ];

  // The stored (firing-invariant interchange) artifact, with a, b unfired (the
  // user's evt_1 firing is irrelevant to lowering; a bare EVENT base stores its own
  // id and waits for a runtime firing).
  const resolveStored = () => {
    const result = resolveInterchange(
      collisionProgram(),
      ctxInput({ grantDate: "2026-01-01", grantQuantity: 1000 }),
    );
    if (result.status !== "template")
      throw new Error(`expected template, got ${result.status}`);
    return result;
  };

  it("persists the stand-in as `evt:1` and keeps the user's `evt_1` statement untouched", () => {
    const stored = resolveStored();

    // The two statements carry distinct ids: the stand-in's reserved-namespace id
    // and the user's own name.
    expect(stored.template.statements.map((s) => s.vesting_base)).toEqual([
      { type: "EVENT", event_id: "evt:1" },
      { type: "EVENT", event_id: "evt_1" },
    ]);

    // Only the stand-in earns a source-map entry; the user event is a plain
    // milestone with nothing to look up.
    const persisted = toPersisted(stored);
    expect(Object.keys(fromSidecar(persisted.sidecar))).toEqual(["evt:1"]);
  });

  it("the persisted artifact round-trips through toPersisted with no throw", () => {
    // AC3: a normally-lowered artifact (synthetic `evt:1` key with a matching
    // template statement) persists cleanly.
    const stored = resolveStored();
    expect(() => toPersisted(stored)).not.toThrow();
  });

  it("reloading does not let the user's `evt_1` firing shadow the pending stand-in", () => {
    const stored = resolveStored();
    const persisted: PersistedArtifact = JSON.parse(
      JSON.stringify(toPersisted(stored)),
    );

    // Re-resolve with a, b still unfired. (A genuine `evt_1` firing reaches the
    // record keeper on the runtime channel, not through `events` — rehydration
    // reads `events` only to settle synthetic definitions — so passing it here
    // would do nothing; we leave it out to keep the test honest.)
    const result = rehydratePersisted(
      persisted,
      ctxInput({ grantDate: "2026-01-01", grantQuantity: 1000 }),
    );

    // The stand-in stays pending: no witness, and its anchors still block —
    // the LATER OF's two unfired events, reported under the selector.
    expect(result.runtime.eventFirings ?? []).toEqual([]);
    expect(result.pending).toContainEqual({
      type: "UNRESOLVED_SELECTOR",
      selector: "LATER_OF",
      blockers: [
        { type: "EVENT_NOT_YET_OCCURRED", event: "a" },
        { type: "EVENT_NOT_YET_OCCURRED", event: "b" },
      ],
    });

    // The user's `evt_1` statement is untouched — still a bare milestone in the
    // frozen template, never collapsed into the stand-in.
    expect(persisted.template.statements.map((s) => s.vesting_base)).toEqual([
      { type: "EVENT", event_id: "evt:1" },
      { type: "EVENT", event_id: "evt_1" },
    ]);
  });
});

// The save-path partition tripwire. The source map a normal persist produces always
// honors the synthetic/named split; a violation can only come from a lowering bug,
// so `toPersisted` throws a PLAIN Error (not the tagged namespace error, not a
// structured refusal) that the persist orchestrator doesn't catch. These build the
// violating artifacts by hand to exercise the tripwire directly.
describe("toPersisted — save-path partition tripwire", () => {
  // A one-statement EVENT-anchored template on `eventId`.
  const templateWithEvent = (eventId: string): VestingScheduleTemplate => ({
    id: "t1",
    statements: [
      {
        order: 1,
        vesting_base: { type: "EVENT", event_id: eventId },
        occurrences: 4,
        period: 1,
        period_type: "MONTHS",
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  });

  const runtime = { grantDate: "2026-01-01" };

  it("throws a plain Error naming a source-map key outside the reserved namespace (AC1)", () => {
    // A key `evt_1` is a legal user Ident, NOT in the `evt:` namespace.
    const sourceMap: SourceMap = {
      evt_1: { definition: "LATER OF(EVENT a, EVENT b)" },
    };
    let thrown: unknown;
    try {
      toPersisted({ template: templateWithEvent("evt_1"), runtime, sourceMap });
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

  it("throws a plain Error, with a distinct message, for a masquerading named event (AC2)", () => {
    // The template statement claims a reserved-namespace id (`evt:1`) but the
    // source map carries no matching entry — a named event masquerading as a
    // synthetic. The source map keys are all reserved, so AC1's half passes.
    const sourceMap: SourceMap = {};
    let thrown: unknown;
    try {
      toPersisted({ template: templateWithEvent("evt:1"), runtime, sourceMap });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("Error");
    expect((thrown as Error).message).toContain(
      'template event "evt:1" in the reserved namespace has no source-map entry',
    );
    // AC1 and AC2 are distinguishable by message substring.
    expect((thrown as Error).message).not.toContain(
      "outside the reserved namespace",
    );
  });

  it("does not throw for a normal synthetic key matched by its template statement (AC3)", () => {
    const sourceMap: SourceMap = {
      "evt:1": { definition: "LATER OF(EVENT a, EVENT b)" },
    };
    expect(() =>
      toPersisted({ template: templateWithEvent("evt:1"), runtime, sourceMap }),
    ).not.toThrow();
  });

  it("does not throw for a plain template with an empty source map (AC3)", () => {
    expect(() =>
      toPersisted({
        template: templateWithEvent("ipo"),
        runtime,
        sourceMap: {},
      }),
    ).not.toThrow();
  });
});
