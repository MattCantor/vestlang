// Rehydration. A stored artifact (template + sourceMap + runtime) with synthetic
// events turns into synthetic-event witnesses by RE-RESOLVING each definition
// against the world's named-event firings; a still-unfired event produces no
// witness and a narrowed blocker; and the source-map definition survives a
// `parse ∘ stringify` round-trip (the fixpoint rehydration relies on).

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
import { stringifyVestingNodeExpr } from "@vestlang/render";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram, evaluateStatement } from "../src/orchestrate";
import {
  rehydrate,
  reparseDefinition,
  isRehydrateDefinitionError,
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
// parse → normalize → evaluate, taking the *interchange* verdict's frozen template,
// source map, and runtime. The firing-invariant interchange is what persist stores
// (the closed-world resolution may have committed an EARLIER OF to a concrete date,
// which is exactly the contingency the stored synthetic must preserve). Used by the
// convention-source tests, which need the runtime lower.ts actually produces (e.g.
// vestingDayOfMonth stored only when non-default) rather than a hand-assembled one.
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

// ---- Issue #231: a corrupt stored definition fails cleanly, not with a raw throw.
//
// A persisted artifact lives in external storage and may be hand-edited, so a
// stored definition can arrive corrupt. Rehydration must surface that as the tagged
// RehydrateDefinitionError naming the offending event_id — for ANY failure mode, and
// identifiable by the literal tag (not instanceof, which a dual ESM/CJS build can
// miss across module realms). The MCP boundary keys on that tag to refuse cleanly.

// A minimal stored artifact: one EVENT-anchored template statement on `eventId`,
// plus a sidecar entry under the same key carrying `definition`. The event_id MUST
// match the sidecar key, or the rehydrate loop's templateEventIds guard skips the
// entry and nothing reparses (a false green). The id must be a reserved synthetic
// (`evt:<n>`): a sidecar entry only ever belongs to a synthetic event, and a
// non-reserved key would trip the namespace guard before any definition reparses.
const corruptSidecarArtifact = (
  eventId: string,
  definition: string,
): {
  template: VestingScheduleTemplate;
  sourceMap: SourceMap;
  runtime: { grantDate: string };
} => ({
  template: {
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
  },
  sourceMap: { [eventId]: { definition } },
  runtime: { grantDate: "2025-01-01" },
});

describe("rehydrate — corrupt sidecar definition (issue #231)", () => {
  // Each is a distinct failure mode that previously propagated raw: a lexical
  // parse error, a grammar semantic-action throw (single-arm combinator), and a
  // multi-statement definition that today truncates silently to the first.
  const failureModes: [name: string, definition: string][] = [
    ["lexically malformed", "TOTALLY NOT DSL (("],
    ["single-arm combinator (semantic-action throw)", "EARLIER OF (EVENT ipo)"],
    [
      "multi-statement (previously truncated)",
      "DATE 2025-01-01 PLUS VEST FROM DATE 2026-01-01",
    ],
  ];

  it.each(failureModes)(
    "throws the tagged error naming the event_id for a %s definition",
    (_name, definition) => {
      const { template, sourceMap, runtime } = corruptSidecarArtifact(
        "evt:1",
        definition,
      );
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
      // Identified by the literal discriminant, not `instanceof`.
      expect(isRehydrateDefinitionError(thrown)).toBe(true);
      if (isRehydrateDefinitionError(thrown)) {
        expect(thrown.event_id).toBe("evt:1");
        expect(thrown.source).toBe("definition");
      }
    },
  );
});

describe("rehydrate — twin path: an illegal bare template event name (issue #231)", () => {
  // No sidecar entry, so the bare-event loop synthesizes `EVENT <id>` and reparses
  // it. An id that isn't a legal bare name (embedded space, leading digit) trips the
  // parser; the throw must come back tagged, naming that id, with source
  // "template-event-name".
  const illegalNames: [name: string, eventId: string][] = [
    ["embedded space", "my event"],
    ["leading digit", "1ipo"],
  ];

  it.each(illegalNames)(
    "throws the tagged error naming the event_id (%s)",
    (_name, eventId) => {
      const template: VestingScheduleTemplate = {
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
      };
      let thrown: unknown;
      try {
        rehydrate(template, {}, { grantDate: "2025-01-01" }, ctxInput());
      } catch (e) {
        thrown = e;
      }
      expect(isRehydrateDefinitionError(thrown)).toBe(true);
      if (isRehydrateDefinitionError(thrown)) {
        expect(thrown.event_id).toBe(eventId);
        expect(thrown.source).toBe("template-event-name");
      }
    },
  );
});

// The grant's frozen conventions — day-of-month and grant date — must come from
// the stored runtime, never the caller. The witness is re-resolved under the
// stored rule so it lands on the same grid the projection compiles under (the
// projection always reads runtime). A conflicting caller value must NOT leak in.

describe("rehydrate — day-of-month sourced from the artifact, not the caller", () => {
  // `EVENT ipo + 1 month` carries a month offset, so lower.ts externalizes the
  // start as a synthetic. The offset is a displacement, so it steps EXACT (#253):
  // ipo on Jan 31 + 1 month keeps day 31 and clamps to Feb's last day
  // (2025-02-28) — it does NOT snap to the stored "15". The *grid* still re-snaps
  // to the 15th from that witness, identically on both sides of the round-trip.
  const DSL = "VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH";

  it("re-resolves the witness exact under the stored rule (2025-02-28), ignoring ctxInput", () => {
    const { template, sourceMap, runtime } = storedFromDsl(
      DSL,
      ctxInput({ grantQuantity: 400, vesting_day_of_month: "15" }),
    );
    // The rule is genuinely frozen into the artifact (it's non-default, so
    // lower.ts stores it). It's the grid that reads it, not the offset.
    expect(runtime.vestingDayOfMonth).toBe("15");

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      // A conflicting day-of-month — the canonical default. The witness is exact
      // regardless of which rule wins, so this case no longer turns on the rule
      // for the witness date; what it pins is that the stored "15" (not the
      // caller's default) is the one carried into the runtime the grid compiles
      // under. Both rules yield the same exact 2025-02-28 witness here.
      ctxInput({
        events: { ipo: "2025-01-31" },
        grantQuantity: 400,
        vesting_day_of_month: DEFAULT_VESTING_DAY_OF_MONTH,
      }),
    );

    const [syntheticId] = Object.keys(sourceMap);
    expect(result.runtime.eventFirings).toEqual([
      { event_id: syntheticId, date: "2025-02-28" },
    ]);

    // What proves the stored "15" (not the caller's default) drove the result is
    // the GRID, not the witness: the witness is exact under either rule. Compile
    // from the rehydrated runtime — the grid re-snaps off the 2025-02-28 witness
    // to the 15th. Under the caller's default it would keep day 28 instead.
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

// ---- Issue #253, AC8: round-trip consistency under the exact offset rule. The
// persisted witness is exact (keep-day, clamp), the grid re-snaps to the policy
// day from it, and a persist→rehydrate of the same world reproduces the identical
// schedule on both sides.

describe("rehydrate — #253 round-trip consistency (exact witness, re-snapped grid)", () => {
  const DSL = "VEST FROM EVENT ipo + 1 month OVER 4 MONTHS EVERY 1 MONTH";

  it("persist→rehydrate reproduces the same exact-witness, 15th-grid schedule", () => {
    // Evaluate once with the IPO already fired (Jan 31), under rule "15", to get
    // the schedule the live engine produces. A fired EVENT-anchored start is a
    // storable `template` whose installments are all RESOLVED.
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
    // The live grid snaps to the 15th off the exact 2025-02-28 start.
    expect(liveDates).toEqual([
      "2025-03-15",
      "2025-04-15",
      "2025-05-15",
      "2025-06-15",
    ]);

    // Now the persisted form: build the stored artifact with the IPO STILL unfired
    // (a template carrying the synthetic), then rehydrate once the IPO fires. The
    // stored runtime carries the frozen "15".
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

    // The witness is the exact offset (Jan 31 + 1 month, keep-day clamp), NOT a
    // snap to the 15th.
    const [syntheticId] = Object.keys(sourceMap);
    expect(rehydrated.runtime.eventFirings).toEqual([
      { event_id: syntheticId, date: "2025-02-28" },
    ]);

    // The grid re-snaps to the 15th from that witness, identically on both sides.
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

// ---- Issue #279: reload-path guards against event-id aliasing (hand-built /
// corrupt input).
//
// A persisted artifact is plain JSON a consumer can edit out-of-band. Two boundary
// holes: a sidecar key OUTSIDE the reserved synthetic namespace aliases a real user
// event (the namespace violation), and a non-synthetic template event_id that
// reparses to a valid-but-NON-bare anchor silently shifts or fabricates a witness
// (the fourth invariant). Both must refuse, each through its own channel.

// A one-statement EVENT-anchored template on `eventId`.
const eventTemplate = (eventId: string): VestingScheduleTemplate => ({
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

describe("rehydrate — namespace violation: a non-reserved sidecar key (issue #279)", () => {
  it("throws the tagged SyntheticNamespaceError naming the offending key", () => {
    // `evt_1` is a legal user Ident, outside the `evt:` namespace. Today this would
    // silently re-resolve the tampered definition and shadow the user's real `evt_1`.
    const sourceMap: SourceMap = {
      evt_1: { definition: "LATER OF(EVENT a, EVENT b)" },
    };
    let thrown: unknown;
    try {
      rehydrate(
        eventTemplate("evt_1"),
        sourceMap,
        { grantDate: "2026-01-01" },
        ctxInput({ grantQuantity: 1000 }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(isSyntheticNamespaceError(thrown)).toBe(true);
    if (isSyntheticNamespaceError(thrown)) {
      expect(thrown.event_id).toBe("evt_1");
    }
    // NOT a corrupt-definition error — this path never reparses.
    expect(isRehydrateDefinitionError(thrown)).toBe(false);
  });

  it("catches a stray key even with no matching template statement (raw-key scan)", () => {
    // The stray key `nope` matches no template statement, so the templateEventIds
    // filter would skip it — but the raw-key scan still catches it (D6).
    const sourceMap: SourceMap = { nope: { definition: "EVENT ipo" } };
    let thrown: unknown;
    try {
      rehydrate(
        eventTemplate("ipo"),
        sourceMap,
        { grantDate: "2026-01-01" },
        ctxInput({ grantQuantity: 1000 }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(isSyntheticNamespaceError(thrown)).toBe(true);
    if (isSyntheticNamespaceError(thrown)) {
      expect(thrown.event_id).toBe("nope");
    }
  });
});

describe("rehydrate — fourth invariant: a template event_id that reparses non-bare (issue #279)", () => {
  // These reparse SUCCESSFULLY today and silently corrupt the witness — the cases
  // the round-trip identity check uniquely closes:
  //   - `"a + 6 months"` → `EVENT a` + a 6-month offset, shifting the date;
  //   - `"grant_date"` / `"grantDate"` → the GRANT_DATE system anchor, fabricating
  //     a firing where a genuine floating event would stay pending.
  const loadBearing: [name: string, eventId: string][] = [
    ["offset anchor", "a + 6 months"],
    ["grant-date system anchor (snake)", "grant_date"],
    ["grant-date system anchor (camel)", "grantDate"],
  ];

  it.each(loadBearing)(
    "refuses with the tagged error (source template-event-name): %s",
    (_name, eventId) => {
      let thrown: unknown;
      try {
        rehydrate(
          eventTemplate(eventId),
          {},
          { grantDate: "2026-01-01" },
          ctxInput({ grantQuantity: 1000 }),
        );
      } catch (e) {
        thrown = e;
      }
      expect(isRehydrateDefinitionError(thrown)).toBe(true);
      if (isRehydrateDefinitionError(thrown)) {
        expect(thrown.event_id).toBe(eventId);
        expect(thrown.source).toBe("template-event-name");
      }
    },
  );

  // Regression coverage: these already throw at parse time via the existing reparse
  // guards (embedded space / leading-digit-then-dash aren't legal bare names), so
  // they're not the new mechanism's load-bearing cases — but they must keep refusing.
  const regression: [name: string, eventId: string][] = [
    ["embedded space", "a b"],
    ["dash", "a-1"],
  ];

  it.each(regression)(
    "still refuses (already caught at parse time): %s",
    (_name, eventId) => {
      let thrown: unknown;
      try {
        rehydrate(
          eventTemplate(eventId),
          {},
          { grantDate: "2026-01-01" },
          ctxInput({ grantQuantity: 1000 }),
        );
      } catch (e) {
        thrown = e;
      }
      expect(isRehydrateDefinitionError(thrown)).toBe(true);
      if (isRehydrateDefinitionError(thrown)) {
        expect(thrown.source).toBe("template-event-name");
      }
    },
  );

  it("a genuine floating `ipo` still stays pending, no witness (unchanged)", () => {
    const result = rehydrate(
      eventTemplate("ipo"),
      {},
      { grantDate: "2026-01-01" },
      ctxInput({ grantQuantity: 1000, events: {} }),
    );
    expect(result.runtime.eventFirings ?? []).toEqual([]);
    expect(findsEventNotOccurred(result.pending, "ipo")).toBe(true);
  });
});

describe("rehydrate — dropped-sidecar synthetic stays opaque (issue #279)", () => {
  it("an `evt:1` template statement with no sidecar rehydrates without throwing", () => {
    // AC7: the reload check does NOT run the masquerade half, so a synthetic whose
    // sidecar was dropped resolves to no witness rather than refusing.
    const result = rehydrate(
      eventTemplate("evt:1"),
      {},
      { grantDate: "2026-01-01" },
      ctxInput({ grantQuantity: 1000 }),
    );
    expect(result.runtime.eventFirings ?? []).toEqual([]);
  });
});
