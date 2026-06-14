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
  EvaluationContextInput,
  Program,
  Statement,
} from "@vestlang/types";
import {
  assertValidVestingScheduleTemplate,
  compileToInstallments,
} from "@vestlang/core";
import { evaluateStatement } from "../src/evaluate/index";
import {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
  resolveToCore,
  type PersistedArtifact,
} from "../src/resolve/index";
import {
  makeSingletonNode,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
} from "./helpers";

const ctxInput = (
  overrides: Partial<EvaluationContextInput> = {},
): EvaluationContextInput => ({
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

// The stored artifact (IPO unfired): a `template` arm with the synthetic EVENT
// statement, an empty runtime (no witness), and the source map.
const storedArtifact = () => {
  const { resolution } = evaluateStatement(
    stageAStmt(),
    ctxInput({ grantQuantity: 4800 }),
  );
  if (resolution.status !== "template")
    throw new Error(`expected template, got ${resolution.status}`);
  return {
    template: resolution.template,
    sourceMap: resolution.sourceMap,
    runtime: resolution.runtime,
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
    const { resolution } = evaluateStatement(
      plainStmt(),
      ctxInput({ grantQuantity: 4800 }),
    );
    if (resolution.status !== "template")
      throw new Error(`expected template, got ${resolution.status}`);
    expect(resolution.sourceMap).toEqual({});

    expect(toSidecar(resolution.sourceMap)).toBeUndefined();
    const persisted = toPersisted(resolution);
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

  // Resolve with a, b unfired (the user's evt_1 firing is irrelevant to lowering;
  // a bare EVENT base stores its own id and waits for a runtime firing).
  const resolveStored = () => {
    const result = resolveToCore(
      collisionProgram(),
      ctxInput({ grantDate: "2026-01-01", grantQuantity: 1000 }),
    );
    if (result.kind !== "template")
      throw new Error(`expected template, got ${result.kind}`);
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
