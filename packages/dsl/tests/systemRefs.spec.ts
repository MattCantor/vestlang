import { describe, it, expect } from "vitest";
import { parse } from "../src/index";
import { VestingNode } from "@vestlang/types";

const asJSON = (x: unknown) => JSON.parse(JSON.stringify(x));
const first = (src: string) => asJSON(parse(src)[0]);

describe("Bareword system references", () => {
  it("accepts bareword grantDate in FROM (no EVENT keyword)", () => {
    const stmt = first(`VEST FROM grantDate OVER 12 months EVERY 12 months`);
    const vs = stmt.expr.vesting_start as VestingNode;
    expect(vs.type).toBe("NODE");
    expect(vs.base).toEqual({ type: "EVENT", value: "grantDate" });
    expect(vs.offsets).toEqual([]);
  });

  it("accepts bareword grantDate with a duration offset in FROM", () => {
    const stmt = first(
      `VEST FROM grantDate + 12 months OVER 36 months EVERY 1 month`,
    );
    const vs = stmt.expr.vesting_start as VestingNode;
    expect(vs.base).toEqual({ type: "EVENT", value: "grantDate" });
    expect(vs.offsets).toEqual([
      { type: "DURATION", value: 12, unit: "MONTHS", sign: "PLUS" },
    ]);
  });

  it("accepts the grant_date and grant-date spellings", () => {
    for (const spelling of ["grant_date", "grant-date", "GRANTDATE"]) {
      const stmt = first(`VEST FROM ${spelling} OVER 12 months EVERY 1 month`);
      const vs = stmt.expr.vesting_start as VestingNode;
      expect(vs.base).toEqual({ type: "EVENT", value: "grantDate" });
    }
  });

  it("bareword grantDate and EVENT grantDate produce identical nodes", () => {
    const bare = first(`VEST FROM grantDate + 1 year`);
    const kw = first(`VEST FROM EVENT grantDate + 1 year`);
    expect(bare).toEqual(kw);
  });

  it("composed grantDate-anchored specified cliff parses as a 2-component program", () => {
    const ast = parse(
      `.3 VEST FROM grantDate OVER 12 months EVERY 12 months` +
        ` PLUS .7 VEST FROM grantDate + 12 months OVER 36 months EVERY 1 month`,
    );
    expect(ast).toHaveLength(2);
    const a = ast[0].expr;
    const b = ast[1].expr;
    if (a.type !== "SCHEDULE" || b.type !== "SCHEDULE")
      throw new Error("expected SCHEDULE exprs");
    const aStart = a.vesting_start as VestingNode;
    const bStart = b.vesting_start as VestingNode;
    expect(aStart.base).toEqual({ type: "EVENT", value: "grantDate" });
    expect(aStart.offsets).toEqual([]);
    expect(bStart.base).toEqual({ type: "EVENT", value: "grantDate" });
    expect(bStart.offsets).toEqual([
      { type: "DURATION", value: 12, unit: "MONTHS", sign: "PLUS" },
    ]);
  });

  it("does not shadow user events whose names merely start with 'grant'", () => {
    const stmt = first(
      `VEST FROM event grant before event a and after event b`,
    );
    const vs = stmt.expr.vesting_start as VestingNode;
    expect(vs.base).toEqual({ type: "EVENT", value: "grant" });
  });
});

describe("System event protections (reachable guards)", () => {
  it("errors on bareword vestingStart in FROM", () => {
    expect(() =>
      parse(`VEST FROM vestingStart OVER 12 months EVERY 1 month`),
    ).toThrowError(/vestingStart is a reserved system event/);
  });

  it("still errors on EVENT vestingStart in FROM", () => {
    expect(() => parse(`VEST FROM EVENT vestingStart`)).toThrowError();
  });

  it("errors on bareword grantDate in CLIFF", () => {
    expect(() =>
      parse(`VEST OVER 48 months EVERY 1 month CLIFF grantDate`),
    ).toThrowError(/grantDate is a reserved system event/);
  });

  it("allows bareword vestingStart in CLIFF (explicit, valid)", () => {
    const stmt = first(`VEST OVER 48 months EVERY 1 month CLIFF vestingStart`);
    const cliff = stmt.expr.periodicity.cliff as VestingNode;
    expect(cliff.base).toEqual({ type: "EVENT", value: "vestingStart" });
  });
});
