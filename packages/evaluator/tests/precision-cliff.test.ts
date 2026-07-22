import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { compile } from "@vestlang/core";
import type { ResolvedInstallment } from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";
import { evaluateProgram } from "../src/evaluate";
import { scheduleOf } from "./helpers";

// Issue #359 — the cliff a decimal can't hold exactly. A 100% statement vesting
// OVER 36 months EVERY 12 months with a 12-month cliff puts a third of the grant on
// the cliff date, and a third has no exact ten-place decimal. Stored on the grid
// that third is "0.3333333334", so at 36,000 shares the lump floors to the exact
// 12,000 — where the grid value below it would have paid 11,999 and left the
// schedule limping a share behind for the rest of its life.

const DSL = "VEST OVER 36 months EVERY 12 months CLIFF 12 months";
const GRANT = 36000;

const program = () => normalizeProgram(parse(DSL));

const ctx = {
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: GRANT,
};

describe("cliff on the storage grid — the stored template (#359 AC5)", () => {
  it("stores the cliff as the rounded-up Numeric and the statement as an exact 1", () => {
    const result = resolveToCore(program(), ctx);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") return;
    const stmt = result.template.statements[0];
    expect(stmt.percentage).toBe("1");
    expect(scheduleOf(stmt)!.cliff?.percentage).toBe("0.3333333334");
  });

  it("compiles to three even 12,000-share tranches", () => {
    const result = resolveToCore(program(), ctx);
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    const amounts = events.map((e) => Number(e.amount));
    expect(amounts).toEqual([12000, 12000, 12000]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(GRANT);
  });
});

describe("cliff on the storage grid — the live evaluation path (#359 AC6)", () => {
  it("the resolves-to stream lumps the same 12,000 on the cliff date", () => {
    const schedule = evaluateProgram(program(), ctx);
    expect(schedule.resolvesTo.status).toBe("template");
    const resolved = schedule.resolvesTo.installments.filter(
      (i): i is ResolvedInstallment => i.state === "RESOLVED",
    );
    const amounts = resolved.map((i) => i.amount);
    expect(amounts).toEqual([12000, 12000, 12000]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(GRANT);
  });
});

describe("cliff on the storage grid — the precision guard (#359 AC7)", () => {
  it("emits no precision finding once the stored cliff lands the lump", () => {
    const result = resolveToCore(program(), ctx);
    expect(
      result.findings.filter((f) => f.kind === "precision-insufficient"),
    ).toEqual([]);
  });

  it("a terminating cliff percentage emits no precision finding", () => {
    // OVER 48 EVERY 12 CLIFF 12 → a quarter on the cliff, "0.25", exact.
    const quarterly = normalizeProgram(
      parse("VEST OVER 48 months EVERY 12 months CLIFF 12 months"),
    );
    const result = resolveToCore(quarterly, {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 40000,
    });
    expect(
      result.findings.some((f) => f.kind === "precision-insufficient"),
    ).toBe(false);
  });

  it("at a huge grant the cliff is not-representable — a finding with no recommendation", () => {
    // The same 1/3 cliff against 30,000,000,000 shares. At that size the window
    // around the intended count is narrower than 10⁻¹⁰, so no ≤10-place decimal
    // lands it: the analyzer's verdict is not-representable, and the finding
    // carries the exact 1/3 but no recommended decimal. This is the one thing the
    // guard still has to say, so it must not have gone quiet with the rest.
    const result = resolveToCore(program(), {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 30000000000,
    });
    const precision = result.findings.filter(
      (f) => f.kind === "precision-insufficient",
    );
    expect(precision).toHaveLength(1);
    const f = precision[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.inferred).toEqual({ numerator: 1, denominator: 3 });
    expect(f.recommended).toBeUndefined();
  });
});

// #386 AC5 — the template arm exercised at a NON-100% statement and a lossy grant.
// Every #359 case above uses a 100% statement, where floor(1 × grant) = grant and
// the per-statement basis is already exact. A single < 100% statement routes to the
// template arm too (an under-allocation is legal), and at a lossy grant its cliff is
// where a double-floored per-statement basis used to go wrong.
describe("cliff on the storage grid — the template arm at a lossy basis (#386 AC5)", () => {
  // A 0.5 statement, 2/3 cliff, grant 1005: floor(0.5 × 1005) = 502 is a lossy basis
  // (0.5 × 1005 = 502.5). Two thirds of that half is 335 exactly, and the stored
  // "0.6666666667" pays it.
  const DSL_LOSSY =
    "0.5 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF 2 months";
  const lossyCtx = {
    grantDate: "2019-01-01",
    events: {},
    grantQuantity: 1005,
  };

  it("routes to the template arm and reports nothing — the lump is exact", () => {
    const result = resolveToCore(normalizeProgram(parse(DSL_LOSSY)), lossyCtx);
    expect(result.kind).toBe("template");
    expect(
      result.findings.filter((f) => f.kind === "precision-insufficient"),
    ).toEqual([]);
  });

  it("pays the exact 335 on the cliff date, on both the compiled and live paths", () => {
    const result = resolveToCore(normalizeProgram(parse(DSL_LOSSY)), lossyCtx);
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    const onCliff = events.filter((e) => e.date === "2020-03-01");
    expect(onCliff.map((e) => Number(e.amount))).toEqual([335]);
    // Cross-check the live path agrees.
    const schedule = evaluateProgram(
      normalizeProgram(parse(DSL_LOSSY)),
      lossyCtx,
    );
    if (schedule.resolvesTo.status !== "template")
      throw new Error("expected template");
    const lump = schedule.resolvesTo.installments
      .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
      .find((i) => i.date === "2020-03-01");
    expect(lump?.amount).toBe(335);
  });
});

// #386 — a contingent-start template (a pending-event head that still lowers to a
// stored template via the sentinel start) with a RESOLVED bare-duration cliff keeps
// its cliff warning. The template arm must NOT adopt the events-arm materialize gate:
// a vestlang-blind reader holds the stored template and could materialize it once the
// event fires, and a bare-duration cliff's lump IS sized from the stored decimal, so
// it is still worth flagging. The lump's cliff date is unknown (anchor-free deferred
// lowering), so it routes to the conservative branch.
//
// (This is a RESOLVED cliff — `CLIFF 12 months` lowers anchor-free to a duration cliff
// with no event hold. An EVENT_HELD cliff is a different shape, excluded entirely; see
// the next describe block.)
describe("cliff on the storage grid — a contingent-start template keeps its warning (#386)", () => {
  it("warns conservatively (recommended omitted) rather than going silent", () => {
    const dsl =
      "VEST FROM EVENT ipo OVER 36 months EVERY 12 months CLIFF 12 months";
    const result = resolveToCore(normalizeProgram(parse(dsl)), {
      grantDate: "2025-01-01",
      events: {}, // ipo unfired
      grantQuantity: 36000,
    });
    expect(result.kind).toBe("template");
    const precision = result.findings.filter(
      (f) => f.kind === "precision-insufficient",
    );
    expect(precision).toHaveLength(1);
    const f = precision[0];
    if (f.kind !== "precision-insufficient") throw new Error("wrong kind");
    expect(f.severity).toBe("warning");
    expect(f.path).toEqual(["statements", 0, "cliff"]);
    expect(f.percentage).toBe("0.3333333334");
    // The conservative shape: no cliff date to prove leading → warn, recommended
    // omitted, conservative flagged. (It still warns — the regression guard.)
    expect(f.conservative).toBe(true);
    expect(f.recommended).toBeUndefined();
  });
});

// #386 — an EVENT_HELD cliff is excluded from the precision pass on the template arm
// too. `CLIFF LATER OF(12 months, EVENT ipo)` stores its time baseline in the
// template's `schedule.cliff` (the Carta baseline) plus an `event_condition` hold, so
// the old `s.schedule?.cliff` template-arm read WOULD have analyzed that decimal. But
// the realizer never sizes the lump from it (held until ipo fires, then proportional),
// so analyzing it is a false positive. The RESOLVED-only gate excludes it — this is
// the AC that FLIPPED from "keeps its warning" once the realizer was ground-truthed.
describe("over-precise event-held cliff baseline is excluded (#386)", () => {
  it("draws no precision finding even though the time baseline is over-precise", () => {
    const dsl =
      "VEST FROM DATE 2025-01-01 OVER 36 months EVERY 12 months CLIFF LATER OF(12 months, EVENT ipo)";
    const result = resolveToCore(normalizeProgram(parse(dsl)), {
      grantDate: "2025-01-01",
      events: {}, // ipo unfired
      grantQuantity: 36000,
    });
    expect(result.kind).toBe("template");
    // The stored template DOES carry the rounded baseline decimal...
    if (result.kind === "template") {
      expect(scheduleOf(result.template.statements[0])?.cliff?.percentage).toBe(
        "0.3333333334",
      );
    }
    // ...but the precision pass does NOT warn on it (the lump is proportional / held).
    expect(
      result.findings.some((f) => f.kind === "precision-insufficient"),
    ).toBe(false);
  });
});

// #386 / #442 / #512 — a multi-statement apportioned cliff whose stored statement
// basis and cliff percentage are BOTH ten-place values ("0.3333333334" each). Their
// 10^10 × 10^10 product once overflowed the
// exact-integer allocator's Number-backed Fraction guard, so this template used to
// throw `exceeds Number.MAX_SAFE_INTEGER` — and since #442 moved allocation into
// `resolveToCore` (it allocates eagerly to carry the breakdown's provenance), that
// throw surfaced straight from `resolveToCore`, the same error the public
// `compile`/`evaluateProgram` path produced. #512 moved the kernel's share math to
// BigInt-exact rationals, so the product no longer overflows and the template
// compiles: 1/3 + 1/3 + 1/3 of 72,000 over nine months lands as nine clean
// 8,000-share installments.
describe("multi-statement apportioned cliff compiles under BigInt share math (#512)", () => {
  const THEN_THIRDS =
    "1/3 VEST FROM DATE 2020-01-01 OVER 3 months EVERY 1 month CLIFF 1 month THEN 1/3 VEST OVER 3 months EVERY 1 month THEN 1/3 VEST OVER 3 months EVERY 1 month";
  const ctx2 = {
    grantDate: "2019-01-01",
    events: {},
    grantQuantity: 72000,
  };
  const EXPECTED = [
    "2020-02-01",
    "2020-03-01",
    "2020-04-01",
    "2020-05-01",
    "2020-06-01",
    "2020-07-01",
    "2020-08-01",
    "2020-09-01",
    "2020-10-01",
  ].map((date) => ({ date, amount: 8000 }));

  it("resolveToCore builds a template and compiles to nine 8,000-share months", () => {
    const result = resolveToCore(normalizeProgram(parse(THEN_THIRDS)), ctx2);
    expect(result.kind).toBe("template");
    if (result.kind !== "template") throw new Error("expected template");
    const events = compile(result.template, result.totalShares, result.runtime);
    expect(
      events.map((e) => ({ date: e.date, amount: Number(e.amount) })),
    ).toEqual(EXPECTED);
    expect(events.reduce((a, e) => a + Number(e.amount), 0)).toBe(72000);
  });

  it("the public evaluate path agrees — no MAX_SAFE throw", () => {
    const schedule = evaluateProgram(
      normalizeProgram(parse(THEN_THIRDS)),
      ctx2,
    );
    expect(schedule.resolvesTo.status).toBe("template");
    if (schedule.resolvesTo.status !== "template")
      throw new Error("expected template");
    const resolved = schedule.resolvesTo.installments.filter(
      (i): i is ResolvedInstallment => i.state === "RESOLVED",
    );
    expect(resolved.map((i) => ({ date: i.date, amount: i.amount }))).toEqual(
      EXPECTED,
    );
    expect(resolved.reduce((a, i) => a + i.amount, 0)).toBe(72000);
  });
});
