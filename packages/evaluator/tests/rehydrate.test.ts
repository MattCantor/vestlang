// Rehydration. A stored artifact (template + sourceMap + runtime) with synthetic
// events turns into synthetic-event witnesses by RE-RESOLVING each definition
// against the world's named-event firings; a still-unfired event produces no
// witness and a narrowed blocker; and the source-map definition survives a
// `parse ∘ stringify` round-trip (the fixpoint rehydration relies on).

import { describe, it, expect } from "vitest";
import type {
  Amount,
  Blocker,
  EvaluationContextInput,
  Schedule,
} from "@vestlang/types";
import { compileToInstallments } from "@vestlang/core";
import { stringifyVestingNodeExpr } from "@vestlang/render";
import { evaluateStatement } from "../src/evaluate/index";
import { rehydrate, reparseDefinition } from "../src/resolve/index";
import {
  makeSingletonNode,
  makeVestingBaseEvent,
  makeDuration,
} from "./helpers";

const ctxInput = (
  overrides: Partial<EvaluationContextInput> = {},
): EvaluationContextInput => ({
  events: { grantDate: "2025-01-01" },
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

// Recursively search a blocker tree for the unfired-event leaf.
const findsEventNotOccurred = (bs: Blocker[], event: string): boolean =>
  bs.some(
    (b) =>
      (b.type === "EVENT_NOT_YET_OCCURRED" && b.event === event) ||
      ((b.type === "UNRESOLVED_SELECTOR" || b.type === "IMPOSSIBLE_SELECTOR") &&
        findsEventNotOccurred(b.blockers as Blocker[], event)),
  );

// `100% MONTHLY OVER 48 FROM LATER OF(+12mo, EVENT "ipo")`. `+12mo` desugars to
// the `grantDate` system anchor (→ DATE); `EVENT "ipo"` is the genuine condition
// that earns the synthetic event.
const stageAStmt = (): { amount: Amount; expr: Schedule } => ({
  amount: portion(1, 1),
  expr: {
    type: "SINGLETON",
    vesting_start: {
      type: "LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("grantDate"), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
        makeSingletonNode(makeVestingBaseEvent("ipo")),
      ],
    },
    periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
  },
});

// Build the stored artifact (IPO unfired): a `template` arm carrying the
// synthetic EVENT statement, an empty runtime (no witness), and the source map.
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

describe("rehydrate — Stage C: IPO fires → witness → full projection", () => {
  it("re-resolves the synthetic event to the IPO date and compiles to 4,800", () => {
    const { template, sourceMap, runtime } = storedArtifact();

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        events: { grantDate: "2025-01-01", ipo: "2027-03-01" },
        asOf: "2027-06-01",
        grantQuantity: 4800,
      }),
    );

    // One synthetic witness, dated at the IPO firing (LATER_OF: max(2026-01-01, 2027-03-01)).
    const [syntheticId] = Object.keys(sourceMap);
    expect(result.runtime.eventFirings).toEqual([
      { event_id: syntheticId, date: "2027-03-01" },
    ]);
    expect(result.blockers).toEqual([]);

    // The FROZEN template + witnessed runtime compiles to the full schedule.
    const installments = compileToInstallments(template, 4800, result.runtime);
    expect(installments).toHaveLength(48);
    expect(installments[0].date).toBe("2027-04-01");
    expect(installments[47].date).toBe("2031-03-01");
    expect(sum(installments)).toBe(4800); // telescopes exactly
  });
});

describe("rehydrate — Stage D: IPO still unfired → no witness", () => {
  it("produces no firing and narrows the blocker to EVENT_NOT_YET_OCCURRED: ipo", () => {
    const { template, sourceMap, runtime } = storedArtifact();

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        events: { grantDate: "2025-01-01" }, // ipo unfired
        asOf: "2026-06-01", // grant+12mo passed, IPO not
        grantQuantity: 4800,
      }),
    );

    expect(result.runtime.eventFirings ?? []).toEqual([]); // LATER_OF: open upper bound
    expect(findsEventNotOccurred(result.blockers, "ipo")).toBe(true);
  });
});

describe("rehydrate — parse ∘ stringify fixpoint", () => {
  it("a source-map definition survives reparse → restringify unchanged", () => {
    const { sourceMap } = storedArtifact();
    for (const { definition } of Object.values(sourceMap)) {
      expect(stringifyVestingNodeExpr(reparseDefinition(definition))).toBe(
        definition,
      );
    }
  });
});
