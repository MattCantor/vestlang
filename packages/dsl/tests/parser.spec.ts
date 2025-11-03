import { describe, it, expect } from "vitest";
import { parse } from "../src/index";
import { VestingNode } from "@vestlang/types";

// handy helpers
const asJSON = (x: unknown) => JSON.parse(JSON.stringify(x));
const first = (src: string) => asJSON(parse(src)[0]);

describe("Start & basics", () => {
  it("returns an array even for a single statement", () => {
    const ast = parse(`VEST`);
    expect(Array.isArray(ast)).toBe(true);
    expect(ast).toHaveLength(1);
  });

  it("No FROM/period produces null vesting_start and zero-length period", () => {
    const stmt = first(`VEST`);
    expect(stmt.amount).toEqual({
      type: "PORTION",
      numerator: 1,
      denominator: 1,
    });
    expect(stmt.expr.type).toBe("SINGLETON");
    expect(stmt.expr.vesting_start).toBeNull();
    expect(stmt.expr.periodicity).toEqual({
      type: "DAYS",
      length: 0,
      occurrences: 1,
    });
  });

  it("list form parses with trailing comma", () => {
    const ast = parse(`[ VEST FROM EVENT a, VEST FROM EVENT b, ]`);
    expect(ast).toHaveLength(2);

    const first = ast[0].expr;
    if (first.type !== "SINGLETON")
      throw new Error(`${first} expected to have type "SINGLETON`);
    const firstVestingStart = first.vesting_start as VestingNode;
    expect(firstVestingStart.base.value).toBe("a");

    const second = ast[1].expr;
    if (second.type !== "SINGLETON")
      throw new Error(`${second} expected to have type "SINGLETON"`);
    const secondVestingStart = second.vesting_start as VestingNode;
    expect(secondVestingStart.base.value).toBe("b");
  });
});

describe("Amount parsing", () => {
  it("portion via decimal .5", () => {
    const s = first(`.5 VEST FROM EVENT a`);
    expect(s.amount).toEqual({ type: "PORTION", numerator: 1, denominator: 2 });
  });

  it("portion via fraction (reduces)", () => {
    const s = first(`2/4 VEST FROM EVENT a`);
    expect(s.amount).toEqual({ type: "PORTION", numerator: 1, denominator: 2 });
  });

  it("quantity via integer", () => {
    const s = first(`10 VEST FROM EVENT a`);
    expect(s.amount).toEqual({ type: "QUANTITY", value: 10 });
  });

  it("rejects out-of-range decimal portion", () => {
    expect(() => parse(`1.1 VEST FROM EVENT a`)).toThrowError();
  });
});

describe("Constraints (AND/OR precedence, ATOM leaves)", () => {
  it("parses a single ATOM constraint attached to a node", () => {
    const s = first(`VEST FROM EVENT a BEFORE EVENT b + 10 days`);
    const node = s.expr.vesting_start;
    expect(node.type).toBe("SINGLETON");
    expect(node.constraints).toMatchObject({
      type: "ATOM",
      constraint: {
        type: "BEFORE",
        strict: false,
        base: {
          type: "SINGLETON",
          base: { type: "EVENT", value: "b" },
          offsets: [
            { type: "DURATION", value: 10, unit: "DAYS", sign: "PLUS" },
          ],
        },
      },
    });
  });

  it("canonicalizes offsets: sum per unit, explicit sign, drop zeros", () => {
    const s = first(`VEST FROM EVENT a + 2 months - 1 months + 10 days`);
    const start = (s as any).expr.vesting_start;
    expect(start.type).toBe("SINGLETON");
    expect(start.offsets).toEqual([
      { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
      { type: "DURATION", value: 10, unit: "DAYS", sign: "PLUS" },
    ]);
  });

  it("enforces SQL precedence: AND binds tighter than OR", () => {
    const s = first(
      `VEST FROM EVENT a BEFORE EVENT b AND AFTER EVENT c OR BEFORE DATE 2025-01-02`,
    );
    const c = s.expr.vesting_start.constraints;
    // OR( AND( BEFORE b, AFTER c ), BEFORE date )
    expect(c.type).toBe("OR");
    expect(c.items).toHaveLength(2);
    expect(c.items[0].type).toBe("AND");
    expect(c.items[0].items.map((x: any) => x.type)).toEqual(["ATOM", "ATOM"]);
    expect(c.items[1].type).toBe("ATOM");
  });

  it("Function form works: AND(...), OR(...)", () => {
    const s = first(
      `VEST FROM EVENT a AND( BEFORE EVENT b, AFTER DATE 2025-01-01 )`,
    );
    const c = s.expr.vesting_start.constraints;
    expect(c.type).toBe("AND");
    expect(c.items).toHaveLength(2);
    expect(c.items[0].type).toBe("ATOM");
    expect(c.items[1].type).toBe("ATOM");
  });

  it("disallows selectors in constraints (must use AND/OR)", () => {
    expect(() =>
      parse(`VEST FROM EVENT a BEFORE EARLIER OF ( EVENT b, EVENT c )`),
    ).toThrowError();
  });

  it("disallows naked duration in constraints", () => {
    expect(() => parse(`VEST FROM EVENT a BEFORE +3 months`)).toThrowError();
  });
});

describe("System event protections", () => {
  it("errors if EVENT vestingStart appears as user-provided Ident", () => {
    expect(() => parse(`VEST FROM EVENT vestingStart`)).toThrowError();
  });
});

describe("Over/Every validations", () => {
  it("computes period when OVER is multiple of EVERY", () => {
    const s = first(`VEST OVER 12 months EVERY 3 months`);
    expect(s.expr.periodicity).toEqual({
      type: "MONTHS",
      length: 3,
      occurrences: 4,
    });
  });

  it("errors when OVER not multiple of EVERY", () => {
    expect(() => parse(`VEST OVER 10 days EVERY 3 days`)).toThrowError();
  });

  it("errors when ONLY OVER is present", () => {
    expect(() => parse(`VEST OVER 3 months`)).toThrowError();
  });

  it("errors when ONLY EVERY is present", () => {
    expect(() => parse(`VEST EVERY 1 months`)).toThrowError();
  });

  it("zero/zero yields a single immediate occurrence (identity period)", () => {
    const s = first(`VEST OVER 0 days EVERY 0 days`);
    expect(s.expr.periodicity).toEqual({
      type: "DAYS",
      length: 0,
      occurrences: 1,
    });
  });
});

describe("Misc", () => {
  it("EOF sentinel catches trailing junk", () => {
    expect(() => parse(`VEST hello`)).toThrowError(); // no grammar path allows stray 'hello'
  });

  it("whitespace/newlines around commas tolerated in lists", () => {
    const ast = parse(`[
      VEST FROM EVENT a
      ,
      VEST FROM EVENT b
    ]`);
    expect(ast).toHaveLength(2);
  });
});
