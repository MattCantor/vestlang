// Rehydration. A stored artifact (template + sourceMap + runtime) with a
// contingent start re-derives its real start by RE-RESOLVING the `evt:start` recipe
// against the world's named-event firings; an unfired event leaves the start
// pending (sentinel kept, projection empty); the recipe survives a `parse ∘
// stringify` round-trip; a corrupt recipe or a dropped contingency marker refuses;
// and the stored artifact is never mutated.

import { describe, it, expect } from "vitest";
import type {
  Amount,
  AsOfContextInput,
  Blocker,
  ResolutionContextInput,
  Statement,
} from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { compileToInstallments } from "@vestlang/core";
import { CONTINGENT_START_SENTINEL } from "@vestlang/primitives";
import { stringifyVestingNodeExpr } from "@vestlang/render";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram, evaluateStatement } from "../src/evaluate";
import {
  rehydrate,
  reparseDefinition,
  isRehydrateDefinitionError,
  isRehydrateMissingStartMarkerError,
  isSyntheticNamespaceError,
} from "../src/resolve/index";
import type { SourceMap, VestingScheduleTemplate } from "@vestlang/types";
import {
  makeSingletonNode,
  makeVestingBaseEvent,
  makeDuration,
  makeVestingBaseGrantDate,
} from "./helpers";

// Build a stored `template` artifact straight from DSL, the way persist does:
// parse → normalize → evaluate, taking the firing-invariant INTERCHANGE verdict's
// frozen template, source map, and (StoredTerms) runtime.
const storedFromDsl = (dsl: string, ctx: ResolutionContextInput) => {
  const program = normalizeProgram(parse(dsl));
  const schedule = evaluateProgram(program, ctx);
  const { interchange } = schedule;
  if (interchange.status !== "template")
    throw new Error(`expected template, got ${interchange.status}`);
  return {
    template: interchange.template,
    sourceMap: interchange.sourceMap,
    runtime: interchange.runtime,
  };
};

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

// Recursively search a blocker tree for the unfired-event leaf.
const findsEventNotOccurred = (bs: Blocker[], event: string): boolean =>
  bs.some(
    (b) =>
      (b.type === "EVENT_NOT_YET_OCCURRED" && b.event === event) ||
      ((b.type === "UNRESOLVED_SELECTOR" || b.type === "IMPOSSIBLE_SELECTOR") &&
        findsEventNotOccurred(b.blockers as Blocker[], event)),
  );

// `100% MONTHLY OVER 48 FROM LATER OF(+12mo, EVENT "ipo")` — a contingent start.
const stageAStmt = (): Statement => ({
  type: "STATEMENT",
  amount: portion(1, 1),
  expr: {
    type: "SCHEDULE",
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

describe("rehydrate — IPO fires → re-derived start → full projection", () => {
  it("re-resolves the evt:start recipe to the IPO date and compiles to 4,800", () => {
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

    // LATER_OF(grant+12mo=2026-01-01, ipo=2027-03-01) = 2027-03-01.
    expect(result.startToApply).toEqual({ date: "2027-03-01" });
    expect(result.runtime.startDate).toBe("2027-03-01");
    expect(result.pending).toEqual([]);
    expect(result.dead).toEqual([]);

    // The FROZEN template + re-derived runtime compiles to the full schedule.
    const installments = compileToInstallments(template, 4800, result.runtime);
    expect(installments).toHaveLength(48);
    expect(installments[0].date).toBe("2027-04-01");
    expect(installments[47].date).toBe("2031-03-01");
    expect(sum(installments)).toBe(4800); // telescopes exactly

    // Read-only: the stored runtime keeps the sentinel (idempotent across reloads).
    expect(runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
  });

  it("re-emits the identical start_to_apply on a second reload (idempotent, AC 4)", () => {
    const { template, sourceMap, runtime } = storedArtifact();
    const world = () =>
      ctxInput({
        grantDate: "2025-01-01",
        events: { ipo: "2027-03-01" },
        asOf: "2027-06-01",
        grantQuantity: 4800,
      });

    const first = rehydrate(template, sourceMap, runtime, world());
    const second = rehydrate(template, sourceMap, runtime, world());

    expect(first.startToApply).toEqual({ date: "2027-03-01" });
    expect(second.startToApply).toEqual(first.startToApply);
    // The artifact bakes no date, so every reload re-derives it from the recipe.
    expect(runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
  });
});

describe("rehydrate — IPO still unfired → no start, projection empty", () => {
  it("keeps the sentinel, surfaces ipo as pending, compiles to nothing", () => {
    const { template, sourceMap, runtime } = storedArtifact();

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        grantDate: "2025-01-01",
        events: {}, // ipo unfired
        asOf: "2026-06-01",
        grantQuantity: 4800,
      }),
    );

    expect(result.startToApply).toBeNull(); // LATER_OF: open upper bound
    expect(result.runtime.startDate).toBe(CONTINGENT_START_SENTINEL);
    expect(findsEventNotOccurred(result.pending, "ipo")).toBe(true);
    // The sentinel never reaches the grid — the projection is empty (AC 10).
    expect(compileToInstallments(template, 4800, result.runtime)).toEqual([]);
  });
});

describe("rehydrate — parse ∘ stringify fixpoint", () => {
  it("the evt:start recipe survives reparse → restringify unchanged", () => {
    const { sourceMap } = storedArtifact();
    for (const { definition } of Object.values(sourceMap)) {
      expect(stringifyVestingNodeExpr(reparseDefinition(definition))).toBe(
        definition,
      );
    }
  });
});

// ---- A corrupt stored recipe fails cleanly, not with a raw throw. A persisted
// artifact lives in external storage and may be hand-edited, so the `evt:start`
// recipe can arrive corrupt. Rehydration surfaces that as the tagged
// RehydrateDefinitionError for ANY failure mode, identifiable by the literal tag.

const corruptStartArtifact = (
  definition: string,
): {
  template: VestingScheduleTemplate;
  sourceMap: SourceMap;
  runtime: { grantDate: string; startDate: string };
} => ({
  template: {
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
  },
  sourceMap: { "evt:start": { definition } },
  runtime: { grantDate: "2025-01-01", startDate: CONTINGENT_START_SENTINEL },
});

describe("rehydrate — corrupt evt:start recipe", () => {
  const failureModes: [name: string, definition: string][] = [
    ["lexically malformed", "TOTALLY NOT DSL (("],
    ["single-arm combinator (semantic-action throw)", "EARLIER OF (EVENT ipo)"],
    [
      "multi-statement (previously truncated)",
      "DATE 2025-01-01 PLUS VEST FROM DATE 2026-01-01",
    ],
  ];

  it.each(failureModes)(
    "throws the tagged error naming evt:start for a %s recipe",
    (_name, definition) => {
      const { template, sourceMap, runtime } = corruptStartArtifact(definition);
      let thrown: unknown;
      try {
        rehydrate(
          template,
          sourceMap,
          runtime,
          ctxInput({ grantQuantity: 400 }),
        );
      } catch (e) {
        thrown = e;
      }
      expect(isRehydrateDefinitionError(thrown)).toBe(true);
      if (isRehydrateDefinitionError(thrown)) {
        expect(thrown.event_id).toBe("evt:start");
      }
    },
  );
});

// ---- The damaged-artifact guard (Decision 2): a sentinel startDate with no
// `evt:start` recipe is corrupt — there is nothing to re-derive the real start
// from. A pure corruption guard reading the sentinel value.

describe("rehydrate — damaged artifact: sentinel start, no evt:start recipe", () => {
  const sentinelNoRecipe = (): VestingScheduleTemplate => ({
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

  it("refuses with the tagged RehydrateMissingStartMarkerError", () => {
    let thrown: unknown;
    try {
      rehydrate(
        sentinelNoRecipe(),
        {},
        { grantDate: "2025-01-01", startDate: CONTINGENT_START_SENTINEL },
        ctxInput({ grantQuantity: 400 }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(isRehydrateMissingStartMarkerError(thrown)).toBe(true);
  });

  it("the missing-start-marker guard rejects unrelated errors and non-errors", () => {
    // The guard keys on the `name` tag, not just `instanceof Error`, so a plain
    // Error (or a non-Error) must not be mistaken for it.
    expect(isRehydrateMissingStartMarkerError(new Error("nope"))).toBe(false);
    expect(isRehydrateMissingStartMarkerError("not an error")).toBe(false);
    expect(isRehydrateMissingStartMarkerError(undefined)).toBe(false);
  });

  it("a plain dated artifact (real startDate, no recipe) rehydrates cleanly", () => {
    const result = rehydrate(
      sentinelNoRecipe(),
      {},
      { grantDate: "2025-01-01", startDate: "2025-01-01" },
      ctxInput({ grantQuantity: 400 }),
    );
    expect(result.startToApply).toBeNull();
    expect(result.runtime.startDate).toBe("2025-01-01");
    expect(result.pending).toEqual([]);
  });
});

// ---- A sidecar key OUTSIDE the reserved synthetic namespace aliases a real user
// event (the namespace violation). It must refuse through its own channel.

describe("rehydrate — namespace violation: a non-reserved sidecar key", () => {
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

  it("throws the tagged SyntheticNamespaceError naming the offending key", () => {
    const sourceMap: SourceMap = {
      evt_1: { definition: "LATER OF(EVENT a, EVENT b)" },
    };
    let thrown: unknown;
    try {
      rehydrate(
        sentinelTemplate(),
        sourceMap,
        { grantDate: "2026-01-01", startDate: CONTINGENT_START_SENTINEL },
        ctxInput({ grantQuantity: 1000 }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(isSyntheticNamespaceError(thrown)).toBe(true);
    if (isSyntheticNamespaceError(thrown)) {
      expect(thrown.event_id).toBe("evt_1");
    }
    expect(isRehydrateDefinitionError(thrown)).toBe(false);
  });

  it("rejects a stray evt:<garbage> key — neither evt:start nor numbered (AC 8)", () => {
    const sourceMap: SourceMap = { "evt:bogus": { definition: "EVENT ipo" } };
    let thrown: unknown;
    try {
      rehydrate(
        sentinelTemplate(),
        sourceMap,
        { grantDate: "2026-01-01", startDate: CONTINGENT_START_SENTINEL },
        ctxInput({ grantQuantity: 1000 }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(isSyntheticNamespaceError(thrown)).toBe(true);
    if (isSyntheticNamespaceError(thrown)) {
      expect(thrown.event_id).toBe("evt:bogus");
    }
  });

  it("accepts a numbered evt:<n> key — a legacy artifact stays loadable (AC 8)", () => {
    // The numbered scheme is no longer minted (starts route through `evt:start`),
    // but the namespace guard still recognizes it so a previously-stored artifact
    // carrying one remains loadable. With a real start and no `evt:start` recipe,
    // rehydrate passes the guard and returns the stored runtime unchanged — it must
    // NOT reject `evt:1` as a stray namespace violation.
    const sourceMap: SourceMap = { "evt:1": { definition: "EVENT ipo" } };
    expect(() =>
      rehydrate(
        sentinelTemplate(),
        sourceMap,
        { grantDate: "2026-01-01", startDate: "2026-01-01" },
        ctxInput({ grantQuantity: 1000 }),
      ),
    ).not.toThrow();
  });
});

// The grant's frozen conventions — day-of-month and grant date — come from the
// stored runtime, never the caller. The start is re-resolved under the stored rule
// so it lands on the same grid the projection compiles under.

describe("rehydrate — day-of-month sourced from the artifact, not the caller", () => {
  // `EVENT ipo + 1 month` is a contingent start; the offset steps EXACT (#253):
  // ipo on Jan 31 + 1 month keeps day 31 and clamps to Feb's last day (2025-02-28).
  // The grid then re-snaps to the policy day from that start.
  const DSL = "VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH";

  it("re-resolves the start exact under the stored rule (2025-02-28), ignoring ctxInput", () => {
    const { template, sourceMap, runtime } = storedFromDsl(
      DSL,
      ctxInput({ grantQuantity: 400, vesting_day_of_month: "15" }),
    );
    expect(runtime.vestingDayOfMonth).toBe("15");

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        events: { ipo: "2025-01-31" },
        grantQuantity: 400,
        vesting_day_of_month: DEFAULT_VESTING_DAY_OF_MONTH,
      }),
    );

    expect(result.startToApply).toEqual({ date: "2025-02-28" });
    expect(result.runtime.startDate).toBe("2025-02-28");

    // The grid re-snaps off the 2025-02-28 start to the stored "15" — proof the
    // stored rule (not the caller's default) drove the runtime the grid compiles
    // under.
    const installments = compileToInstallments(template, 400, result.runtime);
    expect(installments).toHaveLength(4);
    expect(installments.map((i) => i.date)).toEqual([
      "2025-03-15",
      "2025-04-15",
      "2025-05-15",
      "2025-06-15",
    ]);
  });
});

describe("rehydrate — #253 round-trip consistency (exact start, re-snapped grid)", () => {
  const DSL = "VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH";

  it("persist→rehydrate reproduces the same exact-start, 15th-grid schedule", () => {
    // Evaluate once with the IPO already fired (Jan 31), under rule "15", to get
    // the live schedule (a fired contingent start is a dated `template`).
    const liveCtx = ctxInput({
      grantQuantity: 400,
      vesting_day_of_month: "15",
      events: { ipo: "2025-01-31" },
    });
    const liveProgram = normalizeProgram(parse(DSL));
    const liveSchedule = evaluateProgram(liveProgram, liveCtx);
    expect(liveSchedule.resolution.status).toBe("template");
    const liveDates = liveSchedule.resolution.installments.map((i) =>
      i.state === "RESOLVED" ? i.date : i.state,
    );
    expect(liveDates).toEqual([
      "2025-03-15",
      "2025-04-15",
      "2025-05-15",
      "2025-06-15",
    ]);

    // The persisted form: build the stored artifact with the IPO STILL unfired,
    // then rehydrate once it fires. The stored runtime carries the frozen "15".
    const { template, sourceMap, runtime } = storedFromDsl(
      DSL,
      ctxInput({ grantQuantity: 400, vesting_day_of_month: "15" }),
    );
    expect(runtime.vestingDayOfMonth).toBe("15");

    const rehydrated = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        grantQuantity: 400,
        vesting_day_of_month: "15",
        events: { ipo: "2025-01-31" },
      }),
    );
    // The re-derived start is the exact offset (Jan 31 + 1 month, keep-day clamp).
    expect(rehydrated.startToApply).toEqual({ date: "2025-02-28" });

    const fromRehydrated = compileToInstallments(
      template,
      400,
      rehydrated.runtime,
    );
    expect(fromRehydrated.map((i) => i.date)).toEqual([
      "2025-03-15",
      "2025-04-15",
      "2025-05-15",
      "2025-06-15",
    ]);
    expect(sum(fromRehydrated)).toBe(400);
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
      // A conflicting grant date (2030-01-01) and a late ipo (2027-01-01). The
      // stored grant date keeps the +12mo bound at 2026-01-01, which the EARLIER OF
      // picks over the late ipo.
      ctxInput({
        grantDate: "2030-01-01",
        events: { ipo: "2027-01-01" },
        grantQuantity: 400,
      }),
    );
    expect(result.startToApply).toEqual({ date: "2026-01-01" });
    expect(result.runtime.startDate).toBe("2026-01-01");
  });
});

// #255 — rehydrating an event-held cliff re-derives its condition firing onto
// runtime.eventFirings (the channel core.compile reads to fold the cliff).
describe("rehydrate — event_condition firings (#255)", () => {
  // AC 4 observable: CLIFF LATER OF(EVENT a, EVENT b) → a synthetic evt:<n>; after
  // rehydrating against firings for a and b, runtime.eventFirings carries
  // { event_id: evt:<n>, date: max(a, b) }.
  it("AC4: a synthetic event_condition re-resolves to max(a,b) on runtime.eventFirings", () => {
    const { template, sourceMap, runtime } = storedFromDsl(
      "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF LATER OF(EVENT a, EVENT b)",
      ctxInput({ grantQuantity: 4800 }),
    );
    const eventId = template.statements[0].event_condition?.event_id;
    expect(eventId).toMatch(/^evt:\d+$/);

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        grantDate: "2025-01-01",
        events: { a: "2026-03-01", b: "2026-07-01" },
        grantQuantity: 4800,
      }),
    );
    expect(result.runtime.eventFirings).toContainEqual({
      event_id: eventId,
      date: "2026-07-01", // max(a, b)
    });
  });

  // AC 8 mechanical witness: the same statement evaluated fired vs unfired yields
  // deep-equal interchange verdicts (firing-invariance), while resolution differs.
  it("AC8: the interchange verdict is deep-equal fired vs unfired", () => {
    const dsl =
      "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF EVENT ipo";
    const program = normalizeProgram(parse(dsl));
    const unfired = evaluateProgram(
      program,
      ctxInput({ grantQuantity: 4800 }),
    ).interchange;
    const fired = evaluateProgram(
      program,
      ctxInput({ events: { ipo: "2026-06-01" }, grantQuantity: 4800 }),
    ).interchange;
    expect(fired).toEqual(unfired);
  });

  // A bare real-event condition re-derives from the world (no sidecar recipe).
  it("a bare real event_condition resolves its firing from the world", () => {
    const { template, sourceMap, runtime } = storedFromDsl(
      "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month CLIFF EVENT ipo",
      ctxInput({ grantQuantity: 4800 }),
    );
    expect(Object.keys(sourceMap)).toEqual([]); // no recipe for a bare real id
    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctxInput({
        grantDate: "2025-01-01",
        events: { ipo: "2027-07-01" },
        grantQuantity: 4800,
      }),
    );
    expect(result.runtime.eventFirings).toContainEqual({
      event_id: "ipo",
      date: "2027-07-01",
    });
  });
});
