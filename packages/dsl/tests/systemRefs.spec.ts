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
    expect(vs.base).toEqual({ type: "GRANT_DATE" });
    expect(vs.offsets).toEqual([]);
  });

  it("accepts bareword grantDate with a duration offset in FROM", () => {
    const stmt = first(
      `VEST FROM grantDate + 12 months OVER 36 months EVERY 1 month`,
    );
    const vs = stmt.expr.vesting_start as VestingNode;
    expect(vs.base).toEqual({ type: "GRANT_DATE" });
    expect(vs.offsets).toEqual([
      { type: "DURATION", value: 12, unit: "MONTHS", sign: "PLUS" },
    ]);
  });

  it("accepts the grant_date and grant-date spellings", () => {
    for (const spelling of ["grant_date", "grant-date", "GRANTDATE"]) {
      const stmt = first(`VEST FROM ${spelling} OVER 12 months EVERY 1 month`);
      const vs = stmt.expr.vesting_start as VestingNode;
      expect(vs.base).toEqual({ type: "GRANT_DATE" });
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
    expect(aStart.base).toEqual({ type: "GRANT_DATE" });
    expect(aStart.offsets).toEqual([]);
    expect(bStart.base).toEqual({ type: "GRANT_DATE" });
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
    expect(cliff.base).toEqual({ type: "VESTING_START" });
  });
});

// The FROM/CLIFF guards must reach inside selector arms, not just the top-level
// node: a bare `CLIFF grantDate` is rejected, so `CLIFF EARLIER OF(grantDate, …)`
// must be too — otherwise the forbidden anchor rides through an arm and resolves
// to a silent no-op cliff.
describe("System event protections (smuggled through selectors)", () => {
  it("errors on vestingStart inside an EARLIER OF in FROM", () => {
    expect(() =>
      parse(
        `VEST FROM EARLIER OF(vestingStart, EVENT ipo) OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/vestingStart is a reserved system event/);
  });

  it("errors on grantDate inside an EARLIER OF in CLIFF", () => {
    expect(() =>
      parse(
        `VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF(grantDate, EVENT ipo)`,
      ),
    ).toThrowError(/grantDate is a reserved system event/);
  });

  it("errors on grantDate inside a LATER OF in CLIFF (other selector tag)", () => {
    expect(() =>
      parse(
        `VEST OVER 48 months EVERY 1 month CLIFF LATER OF(EVENT ipo, grantDate)`,
      ),
    ).toThrowError(/grantDate is a reserved system event/);
  });

  it("errors on a forbidden anchor nested two selectors deep in FROM", () => {
    expect(() =>
      parse(
        `VEST FROM EARLIER OF(EVENT ipo, LATER OF(vestingStart, EVENT acq))` +
          ` OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/vestingStart is a reserved system event/);
  });

  it("errors on a smuggled grantDate in a THEN-segment cliff (shared Cliff rule)", () => {
    expect(() =>
      parse(
        `VEST OVER 12 months EVERY 1 month` +
          ` THEN VEST OVER 36 months EVERY 1 month CLIFF EARLIER OF(grantDate, EVENT ipo)`,
      ),
    ).toThrowError(/grantDate is a reserved system event/);
  });

  it("allows a selector of genuine events in CLIFF (no false positive)", () => {
    const stmt = first(
      `VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF(EVENT ipo, EVENT acq)`,
    );
    expect(stmt.expr.periodicity.cliff.type).toBe("NODE_EARLIER_OF");
  });

  it("allows a selector of genuine events in FROM (no false positive)", () => {
    const stmt = first(
      `VEST FROM EARLIER OF(EVENT a, EVENT b) OVER 12 months EVERY 1 month`,
    );
    expect(stmt.expr.vesting_start.type).toBe("NODE_EARLIER_OF");
  });
});
