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
  const out = evaluateStatement(
    stageAStmt(),
    ctxInput({ grantQuantity: 4800 }),
  );
  if (out.status !== "template")
    throw new Error(`expected template, got ${out.status}`);
  return {
    template: out.template,
    sourceMap: out.sourceMap,
    runtime: out.runtime,
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
    expect(result.blockers).toEqual([]);

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
    const out = evaluateStatement(
      plainStmt(),
      ctxInput({ grantQuantity: 4800 }),
    );
    if (out.status !== "template")
      throw new Error(`expected template, got ${out.status}`);
    expect(out.sourceMap).toEqual({});

    expect(toSidecar(out.sourceMap)).toBeUndefined();
    const persisted = toPersisted(out);
    expect("sidecar" in persisted).toBe(false);
  });
});
