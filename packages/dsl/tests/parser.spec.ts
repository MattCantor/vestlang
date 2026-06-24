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
    expect(stmt.expr.type).toBe("SCHEDULE");
    expect(stmt.expr.vesting_start).toBeNull();
    expect(stmt.expr.periodicity).toEqual({
      type: "DAYS",
      length: 0,
      occurrences: 1,
    });
  });

  it("PLUS composes statements into a flat list", () => {
    const ast = parse(`VEST FROM EVENT a PLUS VEST FROM EVENT b`);
    expect(ast).toHaveLength(2);

    const first = ast[0].expr;
    if (first.type !== "SCHEDULE")
      throw new Error(
        `${JSON.stringify(first)} expected to have type "SCHEDULE`,
      );
    const firstVestingStart = first.vesting_start as VestingNode;
    expect(firstVestingStart.base).toEqual({ type: "EVENT", value: "a" });

    const second = ast[1].expr;
    if (second.type !== "SCHEDULE")
      throw new Error(
        `${JSON.stringify(second)} expected to have type "SCHEDULE"`,
      );
    const secondVestingStart = second.vesting_start as VestingNode;
    expect(secondVestingStart.base).toEqual({ type: "EVENT", value: "b" });
  });
});

describe("Schedule-level selectors", () => {
  it("EARLIER START OF parses to a SCHEDULE_EARLIER_OF over whole schedules", () => {
    const stmt = first(
      `VEST EARLIER START OF(FROM EVENT a OVER 12 months EVERY 1 month, FROM EVENT b OVER 24 months EVERY 1 month)`,
    );
    expect(stmt.expr.type).toBe("SCHEDULE_EARLIER_OF");
    expect(stmt.expr.items).toHaveLength(2);
    expect(
      stmt.expr.items.every((i: { type: string }) => i.type === "SCHEDULE"),
    ).toBe(true);
  });

  it("a bare schedule-level EARLIER OF points at EARLIER START OF", () => {
    expect(() =>
      parse(
        `VEST EARLIER OF(FROM EVENT a OVER 12 months EVERY 1 month, FROM EVENT b OVER 24 months EVERY 1 month)`,
      ),
    ).toThrowError(/EARLIER START OF/);
  });
});

describe("THEN / PLUS composition", () => {
  it("a THEN chain flattens to a head plus chained tails", () => {
    const ast = asJSON(
      parse(
        `100 VEST FROM EVENT grant THEN 200 VEST OVER 12 months EVERY 1 month`,
      ),
    );
    expect(ast).toHaveLength(2);

    // The head carries its own start and is not chained.
    expect(ast[0].chained).toBeUndefined();
    expect(ast[0].expr.vesting_start.base.value).toBe("grant");

    // The tail is marked chained and has no start of its own.
    expect(ast[1].chained).toBe(true);
    expect(ast[1].expr.vesting_start).toBeNull();
    expect(ast[1].expr.periodicity).toEqual({
      type: "MONTHS",
      length: 1,
      occurrences: 12,
    });
  });

  it("every segment after the head is chained", () => {
    const ast = parse(`VEST THEN VEST THEN VEST`);
    expect(ast.map((s) => s.chained ?? false)).toEqual([false, true, true]);
  });

  it("THEN binds tighter than PLUS: A PLUS B THEN C is A PLUS (B THEN C)", () => {
    const ast = parse(
      `VEST FROM EVENT a PLUS VEST FROM EVENT b THEN VEST OVER 12 months EVERY 1 month`,
    );
    // Two parallel components flatten to three statements; only the segment
    // after THEN is chained — C continues B, not the whole PLUS group.
    expect(ast.map((s) => s.chained ?? false)).toEqual([false, false, true]);
  });

  it("FROM after THEN is a teaching error pointing at PLUS", () => {
    expect(() =>
      parse(`VEST FROM EVENT a THEN VEST FROM EVENT b`),
    ).toThrowError(/PLUS/);
  });

  it("a group after THEN is a teaching error, not a raw token failure", () => {
    expect(() => parse(`VEST FROM EVENT a THEN [ VEST ]`)).toThrowError(
      /parallel group/,
    );
  });

  it("the retired bracket list no longer parses", () => {
    expect(() =>
      parse(`[ VEST FROM EVENT a, VEST FROM EVENT b ]`),
    ).toThrowError();
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

  it("rejects out-of-range fraction portion", () => {
    expect(() => parse(`3/2 VEST FROM EVENT a`)).toThrowError(
      /between 0 and 1 inclusive/,
    );
  });

  it("accepts fractions at and within the [0,1] bounds", () => {
    expect(first(`0/1 VEST FROM EVENT a`).amount).toEqual({
      type: "PORTION",
      numerator: 0,
      denominator: 1,
    });
    expect(first(`1/2 VEST FROM EVENT a`).amount).toEqual({
      type: "PORTION",
      numerator: 1,
      denominator: 2,
    });
    expect(first(`1/1 VEST FROM EVENT a`).amount).toEqual({
      type: "PORTION",
      numerator: 1,
      denominator: 1,
    });
  });
});

// #400 — reject share counts / portions / fraction terms / durations that can't be
// held exactly as a number, instead of silently rounding them. The bound lives in the
// shared `Integer` action plus the portion denominator, so one generic message covers
// every integer literal kind.
const SAFE_INT_REJECT = /exceeds the safe integer range/;

describe("Amount precision (#400)", () => {
  it("rejects a share count above MAX_SAFE_INTEGER", () => {
    // parseInt would round 9007199254740993 down to ...992 and store it silently.
    expect(() =>
      parse(`9007199254740993 VEST OVER 12 months EVERY 1 month`),
    ).toThrowError(SAFE_INT_REJECT);
  });

  it("accepts a share count exactly at MAX_SAFE_INTEGER, stored exact", () => {
    const s = first(`9007199254740991 VEST OVER 12 months EVERY 1 month`);
    expect(s.amount).toEqual({ type: "QUANTITY", value: 9007199254740991 });
  });

  it("leaves an ordinary share count unchanged", () => {
    const s = first(`1000000 VEST OVER 12 months EVERY 1 month`);
    expect(s.amount).toEqual({ type: "QUANTITY", value: 1000000 });
  });

  it("rejects an over-precise decimal portion instead of rounding it to 1/1", () => {
    // 18 fractional digits ⇒ denominator 10^18 — parseFloat used to round to {1,1}.
    expect(() =>
      parse(`0.99999999999999999 VEST OVER 12 months EVERY 1 month`),
    ).toThrowError(SAFE_INT_REJECT);
  });

  it("rejects a portion whose denominator alone overflows (10^16)", () => {
    // Distinct from the round-to-1 branch: a tiny value with a 16-digit denominator.
    expect(() =>
      parse(`0.0000000000000001 VEST OVER 12 months EVERY 1 month`),
    ).toThrowError(SAFE_INT_REJECT);
  });

  it("parses 0.25 to {1,4}, byte-identical with the old float path", () => {
    const s = first(`0.25 VEST OVER 12 months EVERY 1 month`);
    expect(s.amount).toEqual({ type: "PORTION", numerator: 1, denominator: 4 });
  });

  it("parses 0.333 to {333,1000} with no float artifact", () => {
    const s = first(`0.333 VEST OVER 12 months EVERY 1 month`);
    expect(s.amount).toEqual({
      type: "PORTION",
      numerator: 333,
      denominator: 1000,
    });
  });

  it("leaves an ordinary portion (0.5) unchanged", () => {
    const s = first(`0.5 VEST OVER 12 months EVERY 1 month`);
    expect(s.amount).toEqual({ type: "PORTION", numerator: 1, denominator: 2 });
  });

  // The bound sits in the shared Integer action, so it also guards fraction terms and
  // duration magnitudes — an over-2^53 numerator or period count is equally uncomputable.
  it("rejects a fraction term above MAX_SAFE_INTEGER", () => {
    expect(() =>
      parse(`99999999999999999/1 VEST OVER 12 months EVERY 1 month`),
    ).toThrowError(SAFE_INT_REJECT);
  });

  it("rejects a duration integer above MAX_SAFE_INTEGER", () => {
    expect(() =>
      parse(`1 VEST OVER 99999999999999999 months EVERY 1 month`),
    ).toThrowError(SAFE_INT_REJECT);
  });

  it("leaves an ordinary duration unchanged", () => {
    const s = first(`1 VEST OVER 48 months EVERY 12 months`);
    expect(s.expr.periodicity).toEqual({
      type: "MONTHS",
      length: 12,
      occurrences: 4,
    });
  });
});

describe("Constraints (AND/OR precedence, ATOM leaves)", () => {
  it("parses a single ATOM constraint attached to a node", () => {
    const s = first(`VEST FROM EVENT a BEFORE EVENT b + 10 days`);
    const node = s.expr.vesting_start;
    expect(node.type).toBe("NODE");
    expect(node.condition).toMatchObject({
      type: "ATOM",
      constraint: {
        type: "BEFORE",
        strict: false,
        base: {
          type: "NODE",
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
    const start = s.expr.vesting_start;
    expect(start.type).toBe("NODE");
    expect(start.offsets).toEqual([
      { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
      { type: "DURATION", value: 10, unit: "DAYS", sign: "PLUS" },
    ]);
  });

  // #402: a bare, anchorless offset of two-or-more terms used to error at the
  // second `+` (only the single-term `+3 months` parsed). It now aggregates the
  // same way an anchored node does — months-first — over an implicit grantDate
  // base, so the bare form and the written-out `grantDate + …` form agree.
  it("aggregates a multi-term bare offset over an implicit grantDate base (#402)", () => {
    const s = first(`VEST FROM +20 days +1 month`);
    const start = s.expr.vesting_start;
    expect(start).toEqual({
      type: "NODE",
      base: { type: "GRANT_DATE" },
      offsets: [
        { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
        { type: "DURATION", value: 20, unit: "DAYS", sign: "PLUS" },
      ],
    });
    // Byte-identical to the explicitly-anchored form.
    const anchored = first(`VEST FROM grantDate + 20 days + 1 month`);
    expect(start).toEqual(anchored.expr.vesting_start);
  });

  it("leaves the single-term bare offset as a bare DURATION (#402)", () => {
    // The normalizer anchors this to the slot's system base; keep it a Duration
    // so that path stays single-term and untouched.
    const s = first(`VEST FROM +3 months`);
    expect(s.expr.vesting_start).toEqual({
      type: "DURATION",
      value: 3,
      unit: "MONTHS",
      sign: "PLUS",
    });
  });

  it("aggregates a multi-term bare cliff over an implicit vestingStart base (#402)", () => {
    const s = first(
      `VEST OVER 12 months EVERY 1 month CLIFF 20 days + 1 month`,
    );
    expect(s.expr.periodicity.cliff).toEqual({
      type: "NODE",
      base: { type: "VESTING_START" },
      offsets: [
        { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
        { type: "DURATION", value: 20, unit: "DAYS", sign: "PLUS" },
      ],
    });
  });

  it("enforces SQL precedence: AND binds tighter than OR in `A AND B OR C`", () => {
    const s = first(
      `VEST FROM EVENT X BEFORE EVENT A AND BEFORE EVENT B OR BEFORE EVENT C`,
    );
    const c = s.expr.vesting_start.condition;
    // OR( AND( BEFORE b, AFTER c ), BEFORE date )
    expect(c.type).toBe("OR");
    expect(c.items).toHaveLength(2);
    expect(c.items[0].type).toBe("AND");
    expect(c.items[0].items.map((x: { type: string }) => x.type)).toEqual([
      "ATOM",
      "ATOM",
    ]);
    expect(c.items[1].type).toBe("ATOM");
  });

  it("enforces SQL precedence: AND binds tighter than OR in 'A OR B AND C'", () => {
    const s = first(
      `VEST FROM EVENT X BEFORE EVENT A OR BEFORE EVENT B AND BEFORE EVENT C`,
    );

    const c = s.expr.vesting_start.condition;
    expect(c.type).toBe("OR");
    expect(c.items).toHaveLength(2);
    expect(c.items[1].type).toBe("AND");
  });

  it("Function form works: AND(...), OR(...)", () => {
    const s = first(
      `VEST FROM EVENT a AND( BEFORE EVENT b, AFTER DATE 2025-01-01 )`,
    );
    const c = s.expr.vesting_start.condition;
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

describe("Date literals", () => {
  it("parses a real calendar date", () => {
    const s = first(`VEST FROM DATE 2024-02-29`);
    expect(s.expr.vesting_start.base).toEqual({
      type: "DATE",
      value: "2024-02-29",
    });
  });

  it("rejects impossible calendar dates the lexical shape admits", () => {
    for (const bad of [
      "2025-02-31",
      "2023-02-29",
      "2025-13-01",
      "0000-01-01",
    ]) {
      expect(() => parse(`VEST FROM DATE ${bad}`)).toThrowError(
        /not a valid calendar date/,
      );
    }
  });

  // #409: the contingent-start sentinel (9999-12-31) IS a real calendar date, so
  // it passes the impossible-date check above — but it's the reserved storage
  // placeholder, so the grammar must refuse a user-supplied literal of it with a
  // distinct reserved-value message (not "not a valid calendar date"). Previously
  // it parsed fine and silently vested zero shares.
  it("rejects the reserved contingent-start sentinel as a DATE literal", () => {
    expect(() => parse(`VEST FROM DATE 9999-12-31`)).toThrowError(/reserved/);
    expect(() => parse(`VEST FROM DATE 9999-12-31`)).toThrowError(/9999-12-31/);
  });

  it("the sentinel's message is distinct from the not-a-valid-date message", () => {
    expect(() => parse(`VEST FROM DATE 9999-12-31`)).not.toThrowError(
      /not a valid calendar date/,
    );
  });

  // The DateLiteral rule is shared by every literal-DATE position, so one grammar
  // guard covers them all — not just the start anchor.
  it("rejects the sentinel in a gate reference (… AFTER DATE 9999-12-31)", () => {
    expect(() =>
      parse(
        `VEST FROM EVENT ipo AFTER DATE 9999-12-31 OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/reserved/);
  });

  it("rejects the sentinel in a selector arm (EARLIER OF (…, DATE 9999-12-31))", () => {
    expect(() =>
      parse(
        `VEST FROM EARLIER OF (DATE 2027-01-01, DATE 9999-12-31) OVER 12 months EVERY 1 month`,
      ),
    ).toThrowError(/reserved/);
  });
});

describe("System event protections", () => {
  it("errors if EVENT vestingStart appears as user-provided Ident", () => {
    expect(() => parse(`VEST FROM EVENT vestingStart`)).toThrowError();
  });

  // The colon is reserved for the engine's stand-in event ids (`evt:<n>`), and an
  // identifier can't contain one. So `EVENT evt:1` can never name a single event
  // `evt:1`: the parser reads `evt` as the name, then chokes on the `:` it has no
  // rule for. This is the tripwire if the identifier alphabet is ever widened —
  // a user name must stay unable to spell a stand-in id.
  it("does not let EVENT evt:1 parse as a single event named `evt:1`", () => {
    expect(() =>
      parse(`VEST FROM EVENT evt:1 OVER 4 months EVERY 1 month`),
    ).toThrowError(/":"/);
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

  // The mismatched-zero messages name the field that is actually zero (#74 item 3).
  it("OVER zero / EVERY non-zero names OVER as the offender", () => {
    expect(() => parse(`VEST OVER 0 months EVERY 1 month`)).toThrowError(
      "OVER must be non-zero when EVERY is non-zero",
    );
  });

  it("EVERY zero / OVER non-zero names EVERY as the offender", () => {
    expect(() => parse(`VEST OVER 12 months EVERY 0 months`)).toThrowError(
      "EVERY must be non-zero when OVER is non-zero",
    );
  });

  // The keyword and its plural `s` are both case-insensitive, so an all-caps
  // plural unit (MONTHS/DAYS/YEARS/WEEKS) parses like its lowercase form.
  it("accepts uppercase plural units", () => {
    const s = first(`VEST OVER 48 MONTHS EVERY 1 MONTH`);
    expect(s.expr.periodicity).toEqual({
      type: "MONTHS",
      length: 1,
      occurrences: 48,
    });
    // years → months, weeks → days conversions still apply through the caps form
    expect(first(`VEST OVER 2 YEARS EVERY 6 MONTHS`).expr.periodicity).toEqual({
      type: "MONTHS",
      length: 6,
      occurrences: 4,
    });
    expect(first(`VEST OVER 4 WEEKS EVERY 7 DAYS`).expr.periodicity).toEqual({
      type: "DAYS",
      length: 7,
      occurrences: 4,
    });
  });
});

describe("Misc", () => {
  it("EOF sentinel catches trailing junk", () => {
    expect(() => parse(`VEST hello`)).toThrowError(); // no grammar path allows stray 'hello'
  });

  it("whitespace/newlines around PLUS and THEN are tolerated", () => {
    const ast = parse(`
      VEST FROM EVENT a
      THEN VEST OVER 12 months EVERY 1 month
      PLUS
      VEST FROM EVENT b
    `);
    expect(ast.map((s) => s.chained ?? false)).toEqual([false, true, false]);
  });
});
