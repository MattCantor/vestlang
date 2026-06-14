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
  Statement,
} from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { compileToInstallments } from "@vestlang/core";
import { stringifyVestingNodeExpr } from "@vestlang/render";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram, evaluateStatement } from "../src/evaluate/index";
import { rehydrate, reparseDefinition } from "../src/resolve/index";
import {
  makeSingletonNode,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
} from "./helpers";

// Build a stored `template` artifact straight from DSL, the way persist does:
// parse → normalize → evaluate, taking the resolution's frozen template, source
// map, and runtime. Used by the convention-source tests, which need the runtime
// lower.ts actually produces (e.g. vestingDayOfMonth stored only when non-default)
// rather than a hand-assembled one.
const storedFromDsl = (dsl: string, ctx: EvaluationContextInput) => {
  const program = normalizeProgram(parse(dsl));
  const [schedule] = evaluateProgram(program, ctx);
  const { resolution } = schedule;
  if (resolution.status !== "template")
    throw new Error(`expected template, got ${resolution.status}`);
  return {
    template: resolution.template,
    sourceMap: resolution.sourceMap,
    runtime: resolution.runtime,
  };
};

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
const stageAStmt = (): Statement => ({
  type: "STATEMENT",
  amount: portion(1, 1),
  expr: {
    type: "SCHEDULE",
    // Items in canonical (normalizer sort) order: EVENT "ipo" sorts before the
    // GRANT_DATE anchor, so a hand-built statement must match that to stay a
    // parse∘stringify fixpoint (the real pipeline normalizes before lowering).
    vesting_start: {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("ipo")),
        makeSingletonNode(makeVestingBaseGrantDate(), [
          makeDuration(12, "MONTHS", "PLUS"),
        ]),
      ],
    },
    periodicity: { type: "MONTHS", length: 1, occurrences: 48 },
  },
});

// Build the stored artifact (IPO unfired): a `template` arm carrying the
// synthetic EVENT statement, an empty runtime (no witness), and the source map.
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

describe("rehydrate — Stage C: IPO fires → witness → full projection", () => {
  it("re-resolves the synthetic event to the IPO date and compiles to 4,800", () => {
    const { template, sourceMap, runtime } = storedArtifact();

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        grantDate: "2025-01-01",
        events: { ipo: "2027-03-01" },
        asOf: "2027-06-01",
        grantQuantity: 4800,
      }),
    );

    // One synthetic witness, dated at the IPO firing (LATER_OF: max(2026-01-01, 2027-03-01)).
    const [syntheticId] = Object.keys(sourceMap);
    expect(result.runtime.eventFirings).toEqual([
      { event_id: syntheticId, date: "2027-03-01" },
    ]);
    expect(result.pending).toEqual([]);
    expect(result.dead).toEqual([]);

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
        grantDate: "2025-01-01",
        events: {}, // ipo unfired
        asOf: "2026-06-01", // grant+12mo passed, IPO not
        grantQuantity: 4800,
      }),
    );

    expect(result.runtime.eventFirings ?? []).toEqual([]); // LATER_OF: open upper bound
    expect(findsEventNotOccurred(result.pending, "ipo")).toBe(true);
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

// The grant's frozen conventions — day-of-month and grant date — must come from
// the stored runtime, never the caller. The witness is re-resolved under the
// stored rule so it lands on the same grid the projection compiles under (the
// projection always reads runtime). A conflicting caller value must NOT leak in.

describe("rehydrate — day-of-month sourced from the artifact, not the caller", () => {
  // `EVENT ipo + 1 month` carries a month offset, so day-of-month bites and
  // lower.ts externalizes it as a synthetic. Stored under rule "15", ipo firing on
  // a month-end: +1 month lands on the 15th of the next month, not its last day.
  const DSL = "VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH";

  it("re-resolves the witness under the stored rule (2025-02-15), ignoring ctxInput", () => {
    const { template, sourceMap, runtime } = storedFromDsl(
      DSL,
      ctxInput({ grantQuantity: 400, vesting_day_of_month: "15" }),
    );
    // The rule is genuinely frozen into the artifact (it's non-default, so
    // lower.ts stores it).
    expect(runtime.vestingDayOfMonth).toBe("15");

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      // A conflicting day-of-month — the canonical default — which would emit
      // 2025-02-28 if the caller's value were consulted.
      ctxInput({
        events: { ipo: "2025-01-31" },
        grantQuantity: 400,
        vesting_day_of_month: DEFAULT_VESTING_DAY_OF_MONTH,
      }),
    );

    const [syntheticId] = Object.keys(sourceMap);
    expect(result.runtime.eventFirings).toEqual([
      { event_id: syntheticId, date: "2025-02-15" },
    ]);
  });
});

describe("rehydrate — grant date sourced from the artifact, not the caller", () => {
  // `EARLIER OF (EVENT ipo, +12 months)`: the `+12 months` bound desugars to
  // grantDate + 12mo. Stored grant date 2025-01-01 puts that bound at 2026-01-01.
  const DSL =
    "VEST FROM EARLIER OF (EVENT ipo, +12 months) OVER 4 MONTHS EVERY 1 MONTH";

  it("settles the grant-anchored bound under the stored grant date (2026-01-01)", () => {
    const { template, sourceMap, runtime } = storedFromDsl(
      DSL,
      ctxInput({ grantQuantity: 400 }),
    );
    expect(runtime.grantDate).toBe("2025-01-01");

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      // A conflicting grant date (2030-01-01) and a late ipo (2027-01-01). If the
      // caller's grant date were used, the +12mo bound would be 2031-01-01 and the
      // EARLIER OF would pick ipo at 2027-01-01. The stored grant date keeps the
      // bound at 2026-01-01, which wins.
      ctxInput({
        grantDate: "2030-01-01",
        events: { ipo: "2027-01-01" },
        grantQuantity: 400,
      }),
    );

    const [syntheticId] = Object.keys(sourceMap);
    expect(result.runtime.eventFirings).toEqual([
      { event_id: syntheticId, date: "2026-01-01" },
    ]);
  });
});
