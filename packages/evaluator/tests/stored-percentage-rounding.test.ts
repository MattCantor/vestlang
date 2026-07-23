import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { compile } from "@vestlang/core";
import { resolveToCore } from "../src/resolve/index";
import { scheduleOf } from "./helpers";

// A vesting percentage is stored as a ten-place decimal, and the share math floors
// a running cumulative. Store a value a hair BELOW the exact share and that floor
// costs a whole share exactly when the true count is a round number — the case
// schedules are designed to hit. Store it a hair above and the same floor absorbs
// it. These pin the two reported programs, the safeguards that keep the round-up
// from inventing shares, and the guard's remaining voice.

const evaluate = (dsl: string, grantQuantity: number, grantDate: string) =>
  resolveToCore(normalizeProgram(parse(dsl)), {
    grantDate,
    events: {},
    grantQuantity,
  });

const projection = (dsl: string, grantQuantity: number, grantDate: string) => {
  const result = evaluate(dsl, grantQuantity, grantDate);
  if (result.kind !== "template") throw new Error("expected a template");
  return compile(result.template, result.totalShares, result.runtime).map(
    (e) => ({ date: e.date, amount: BigInt(e.amount) }),
  );
};

const storedPercentages = (
  dsl: string,
  grantQuantity: number,
  grantDate: string,
) => {
  const result = evaluate(dsl, grantQuantity, grantDate);
  if (result.kind !== "template") throw new Error("expected a template");
  return result.template.statements.map((s) => s.percentage);
};

const precisionFindings = (result: { findings: { kind: string }[] }) =>
  result.findings.filter((f) => f.kind === "precision-insufficient");

describe("a cliff that is a third of its grid", () => {
  const DSL = "VEST OVER 3 years EVERY 1 year CLIFF 1 year";

  it("vests the grant in three equal thirds", () => {
    expect(
      projection(DSL, 30000, "2025-01-01").map((t) => Number(t.amount)),
    ).toEqual([10000, 10000, 10000]);
  });

  it("stores the cliff as the grid value just above a third", () => {
    const result = evaluate(DSL, 30000, "2025-01-01");
    if (result.kind !== "template") throw new Error("expected a template");
    expect(scheduleOf(result.template.statements[0])?.cliff?.percentage).toBe(
      "0.3333333334",
    );
  });

  it("raises no precision finding, because there is nothing left to lose", () => {
    expect(precisionFindings(evaluate(DSL, 30000, "2025-01-01"))).toEqual([]);
  });
});

describe("an authored 19/48 head with a 29/48 tail", () => {
  const DSL =
    "19/48 VEST FROM DATE 2027-05-06 THEN 29/48 VEST OVER 29 months EVERY 1 month";
  const GRANT_DATE = "2025-10-06";

  it("pays the head its exact 19,000 of 48,000 and the tail 1,000 a month", () => {
    const tranches = projection(DSL, 48000, GRANT_DATE);
    expect(Number(tranches[0].amount)).toBe(19000);
    expect(Number(tranches[tranches.length - 1].amount)).toBe(1000);
    expect(tranches.reduce((s, t) => s + t.amount, 0n)).toBe(48000n);
  });

  it("stores the two statements as consecutive rounded running totals", () => {
    expect(storedPercentages(DSL, 48000, GRANT_DATE)).toEqual([
      "0.3958333334",
      "0.6041666666",
    ]);
  });

  it("stores byte-identically at a different grant — the artifact is grant-free", () => {
    // A stored template carries no share count; the quantity is re-supplied at
    // rehydrate. So the same program has to store the same strings whatever grant
    // it was authored against, or a template would silently belong to one grant.
    expect(storedPercentages(DSL, 100000, GRANT_DATE)).toEqual(
      storedPercentages(DSL, 48000, GRANT_DATE),
    );
  });

  it("keeps the 100,000-share projection whole, first tranche included", () => {
    // 19/48 of 100,000 is 39,583⅓ — not a round number, so this grant has nothing
    // to gain and must have nothing to lose either.
    const tranches = projection(DSL, 100000, GRANT_DATE);
    expect(Number(tranches[0].amount)).toBe(39583);
    expect(tranches.reduce((s, t) => s + t.amount, 0n)).toBe(100000n);
  });
});

describe("conservation across the round-up", () => {
  // Rounding every statement up on its own would break this: at a grant past
  // 10^10 the per-statement surplus is worth whole shares, so three independently
  // rounded thirds would pay out more than the grant. Rounding the running total
  // instead keeps the last boundary exactly where the author put it. At small
  // grants the two constructions are indistinguishable, hence the 30-billion case.
  const CASES: { dsl: string; whole: boolean }[] = [
    {
      dsl:
        "1/3 VEST OVER 1 month EVERY 1 month " +
        "THEN 1/3 VEST OVER 1 month EVERY 1 month " +
        "THEN 1/3 VEST OVER 1 month EVERY 1 month",
      whole: true,
    },
    {
      dsl: "1/7 VEST OVER 1 month EVERY 1 month THEN 2/7 VEST OVER 1 month EVERY 1 month THEN 4/7 VEST OVER 1 month EVERY 1 month",
      whole: true,
    },
    {
      dsl: "19/48 VEST OVER 19 months EVERY 1 month THEN 29/48 VEST OVER 29 months EVERY 1 month",
      whole: true,
    },
    { dsl: "VEST OVER 36 months EVERY 12 months CLIFF 12 months", whole: true },
    { dsl: "1/3 VEST OVER 3 months EVERY 1 month", whole: false },
    {
      dsl: "1/3 VEST OVER 3 months EVERY 1 month THEN 1/4 VEST OVER 4 months EVERY 1 month",
      whole: false,
    },
  ];
  const GRANTS = [97, 1005, 30000, 48000, 30000000000];

  it.each(CASES)("holds for $dsl", ({ dsl, whole }) => {
    for (const grant of GRANTS) {
      const tranches = projection(dsl, grant, "2025-01-01");
      const total = tranches.reduce((s, t) => s + t.amount, 0n);
      expect(total).toBeLessThanOrEqual(BigInt(grant));
      if (whole) expect(total).toBe(BigInt(grant));
      for (const t of tranches) expect(t.amount).toBeGreaterThan(0n);
    }
  });
});

describe("the cap that stops a partial schedule reaching 100%", () => {
  it("leaves a sub-100% schedule its round-up — two thirds pay 10,000 each", () => {
    // The cap only binds where the round-up would otherwise reach a full grant.
    // Read as "anything under 100% keeps the lower value" it would put the reported
    // share loss straight back for every partial schedule.
    const dsl =
      "1/3 VEST FROM DATE 2025-01-01 OVER 1 month EVERY 1 month " +
      "THEN 1/3 VEST OVER 1 month EVERY 1 month";
    expect(
      projection(dsl, 30000, "2025-01-01").map((t) => Number(t.amount)),
    ).toEqual([10000, 10000]);
  });

  it("holds a total that is a hair under 100% one ulp below the full grid", () => {
    // 0.99999999995 + 0.00000000001 sums under 1, so no boundary may reach 10^10 —
    // and the cap has to apply to EVERY boundary. The first one alone already
    // rounds up to the full grid, so capping only the last would leave the second
    // statement storing a negative share.
    const dsl =
      "0.99999999995 VEST FROM DATE 2025-01-01 OVER 1 month EVERY 1 month " +
      "THEN 0.00000000001 VEST OVER 1 month EVERY 1 month";
    const result = evaluate(dsl, 30000, "2025-01-01");
    if (result.kind !== "template") throw new Error("expected a template");
    expect(result.template.statements.map((s) => s.percentage)).toEqual([
      "0.9999999999",
      "0",
    ]);
    // The schedule is still reported as leaving shares unvested — the cap keeps the
    // shortfall honest instead of rounding it away.
    expect(result.findings.some((f) => f.kind === "under-allocation")).toBe(
      true,
    );
  });

  it("stores an over-allocating set faithfully rather than reshaping it", () => {
    // Over 100% there is no cap at all: the allocation gate refuses the schedule,
    // which it can only do if the stored numbers still say what was authored.
    const dsl =
      "0.6 VEST FROM DATE 2025-01-01 OVER 1 month EVERY 1 month " +
      "PLUS 0.6 VEST FROM DATE 2025-01-01 OVER 1 month EVERY 1 month";
    const result = evaluate(dsl, 30000, "2025-01-01");
    expect(result.findings.some((f) => f.kind === "over-allocation")).toBe(
      true,
    );
  });
});

describe("what the precision guard still says", () => {
  it("is silent where the stored cliff pays over but a grant-blind value can't do better", () => {
    // Ten billion shares on a 48-month grid with a 19-month cliff: the exact lump is
    // 3,958,333,333⅓ and the stored decimal pays 3,958,333,334. The only decimal
    // that would land it is right at this grant alone, and a stored template has to
    // be right at every grant — so there is nothing to tell the reader. The silence
    // is on direction, not on the size of the surplus: it holds however many shares
    // over the stored value goes.
    const dsl = "VEST OVER 48 months EVERY 1 month CLIFF 19 months";
    expect(precisionFindings(evaluate(dsl, 10000000000, "2025-01-01"))).toEqual(
      [],
    );
    expect(projection(dsl, 10000000000, "2025-01-01")[0].amount).toBe(
      3958333334n,
    );
  });

  it("still speaks where ten places genuinely cannot land the lump", () => {
    const result = evaluate(
      "VEST OVER 36 months EVERY 12 months CLIFF 12 months",
      30000000000,
      "2025-01-01",
    );
    expect(precisionFindings(result)).toHaveLength(1);
  });
});
