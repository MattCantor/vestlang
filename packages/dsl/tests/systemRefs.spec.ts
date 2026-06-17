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

// A FROM start's gate can't reference vestingStart: the gate would constrain the
// very start it defines, and vestingStart is unresolved while that start
// resolves, so the gate pins on a placeholder and never settles. The anchor
// guard above never looks inside the gate condition, so these used to lint clean.
// The same reference on a CLIFF gate is fine (vestingStart is resolved by then)
// and is exercised separately below.
describe("System event protections (vestingStart in a FROM gate is circular)", () => {
  // catch once, assert on message — keeps the gate/anchor message partition honest
  const caught = (src: string): Error => {
    try {
      parse(src);
    } catch (e) {
      return e as Error;
    }
    throw new Error(`expected parse to throw for: ${src}`);
  };

  // AC1: one representative spelling — all SystemRef forms collapse to the same
  // VESTING_START base before the guard runs, so the rejection is spelling-blind.
  it("errors on vestingStart in a FROM gate atom", () => {
    expect(() =>
      parse(
        `100 VEST FROM DATE 2025-01-10 AFTER vesting_start + 1 month OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/circular/);
  });

  // AC2a: the reference rides on one operand of a boolean group
  // (condition.AND.items[i].constraint.base = VESTING_START).
  it("errors on vestingStart inside a boolean AND group in a FROM gate", () => {
    expect(() =>
      parse(
        `100 VEST FROM DATE 2025-01-10 AFTER event a AND after vesting_start OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/circular/);
  });

  // AC2b: the selector sits at the anchor; the gate rides on an arm node. Any arm
  // referencing vestingStart rejects — there's no "chosen" arm at parse time.
  it("errors on vestingStart in an anchor-level selector arm's gate", () => {
    expect(() =>
      parse(
        `100 VEST FROM EARLIER OF(DATE 2025-01-10 AFTER vesting_start, EVENT y) OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/circular/);
  });

  // AC2c: the deepest path — a constraint base that carries its own nested gate
  // (condition.constraint.base.condition.constraint.base = VESTING_START). A check
  // that inspects only the first constraint.base and forgets to recurse into that
  // base's own condition would pass (a)/(b) and still leave this lintable.
  it("errors on vestingStart in a base-of-base nested gate in a FROM start", () => {
    expect(() =>
      parse(
        `100 VEST FROM DATE 2025-01-10 AFTER EVENT ipo AFTER vesting_start OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/circular/);
  });

  // AC3: the meaningful cliff case is untouched — the cliff gate references a
  // VESTING_START node that's already resolved by the time the cliff is computed.
  it("allows vestingStart in a CLIFF gate (resolved by then, not circular)", () => {
    const stmt = first(
      `1000 VEST FROM DATE 2025-01-10 OVER 12 months EVERY 1 month CLIFF EVENT acceleration AFTER vesting_start + 6 months`,
    );
    const cliff = stmt.expr.periodicity.cliff as VestingNode;
    expect(cliff.base).toEqual({ type: "EVENT", value: "acceleration" });
  });

  // AC4: grantDate always resolves, so a grantDate gate on a FROM start is
  // resolvable, never circular — guards against over-rejecting on the system tag.
  it("allows grantDate in a FROM gate (resolvable, not circular)", () => {
    const stmt = first(
      `100 VEST FROM DATE 2025-01-10 AFTER grant_date + 1 month OVER 12 months EVERY 1 month`,
    );
    const vs = stmt.expr.vesting_start as VestingNode;
    expect(vs.base).toEqual({ type: "DATE", value: "2025-01-10" });
  });

  // AC5: no false positives — one success per recursion branch the walk descends,
  // mirroring AC2, proving the walk doesn't over-reject on a branch it enters.
  it("allows a nested-base gate of genuine events (no false positive)", () => {
    const stmt = first(
      `100 VEST FROM DATE 2025-01-10 AFTER event a BEFORE event b OVER 12 months EVERY 1 month`,
    );
    expect(stmt.expr.vesting_start.type).toBe("NODE");
  });

  it("allows a boolean-group gate of genuine events (no false positive)", () => {
    const stmt = first(
      `100 VEST FROM DATE 2025-01-10 AFTER event a AND after event b OVER 12 months EVERY 1 month`,
    );
    expect(stmt.expr.vesting_start.condition.type).toBe("AND");
  });

  it("allows an arm-carried gate of genuine events (no false positive)", () => {
    const stmt = first(
      `100 VEST FROM EARLIER OF(DATE 2025-01-10 AFTER event a, EVENT y) OVER 12 months EVERY 1 month`,
    );
    expect(stmt.expr.vesting_start.type).toBe("NODE_EARLIER_OF");
  });

  // AC6: the anchor and gate messages stay partitioned by position. Assert on a
  // caught error's message (not .not.toThrowError, which also passes when nothing
  // throws and would mask a silent non-rejection).
  it("partitions the gate message: reads as circular, never the anchor message", () => {
    const err = caught(
      `100 VEST FROM DATE 2025-01-10 AFTER vesting_start + 1 month OVER 12 months EVERY 1 month`,
    );
    expect(err.message).toMatch(/vestingStart is a reserved system event/);
    expect(err.message).toMatch(/circular/);
    expect(err.message).not.toMatch(/Pick a different event name/);
  });

  it("partitions the anchor message: keeps the anchor wording, not the circular one", () => {
    const err = caught(`VEST FROM vestingStart OVER 12 months EVERY 1 month`);
    expect(err.message).toMatch(/Pick a different event name/);
    expect(err.message).not.toMatch(/circular/);
  });

  it("partitions the selector-anchor message the same way", () => {
    const err = caught(
      `VEST FROM EARLIER OF(vestingStart, EVENT ipo) OVER 12 months EVERY 1 month`,
    );
    expect(err.message).toMatch(/Pick a different event name/);
    expect(err.message).not.toMatch(/circular/);
  });
});
