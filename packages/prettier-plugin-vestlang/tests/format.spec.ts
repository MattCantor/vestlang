import { describe, it, expect } from "vitest";
import prettier from "prettier";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { stringify } from "@vestlang/render";
import plugin from "../dist/index.js"; // build first

const WIDE = 1_000_000; // stand-in for infinite width

function fmt(src: string, printWidth = 80): Promise<string> {
  return prettier.format(src, {
    plugins: [plugin],
    parser: "vestlang-parser",
    printWidth,
  });
}

function normAst(src: string) {
  return normalizeProgram(parse(src));
}

/**
 * A corpus spanning the grammar: bare/amounts, the full schedule, both sugar
 * collapses, both selector levels, conditions (AND/OR + nesting), a schedule
 * selector, and a multi-statement program.
 */
const corpus = [
  "VEST",
  "100 VEST",
  "1/4 VEST",
  "VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 12 months",
  "VEST FROM 6 months",
  "VEST CLIFF 12 months",
  "VEST FROM EARLIER OF(EVENT ipo, DATE 2026-01-01) OVER 48 months EVERY 1 month CLIFF LATER OF(EVENT board, EVENT legal)",
  "VEST FROM EVENT start AND(BEFORE EVENT a, AFTER EVENT b)",
  "VEST FROM EVENT start OR(BEFORE EVENT a, AND(BEFORE EVENT b, AFTER EVENT c))",
  "VEST FROM LATER OF(EVENT a, EVENT b, EVENT c)",
  "VEST LATER START OF(FROM EVENT a OVER 12 months EVERY 1 month, FROM EVENT b OVER 24 months EVERY 1 month)",
  "1/4 VEST CLIFF 12 months PLUS 3/4 VEST FROM EVENT cliff OVER 36 months EVERY 1 month",
  "100 VEST FROM EVENT grant OVER 12 months EVERY 1 month THEN 200 VEST OVER 24 months EVERY 1 month",
];

const widths = [WIDE, 80, 40, 20];

describe("idempotence", () => {
  for (const src of corpus) {
    for (const w of widths) {
      it(`format(format(x)) === format(x) @${w}: ${src.slice(0, 40)}`, async () => {
        const once = await fmt(src, w);
        const twice = await fmt(once, w);
        expect(twice).toBe(once);
      });
    }
  }
});

describe("round-trip (parse(print(ast)) preserves the normalized AST)", () => {
  for (const src of corpus) {
    for (const w of widths) {
      it(`@${w}: ${src.slice(0, 40)}`, async () => {
        const formatted = await fmt(src, w);
        expect(normAst(formatted)).toEqual(normAst(src));
      });
    }
  }
});

describe("flat print agrees with stringify by construction", () => {
  for (const src of corpus) {
    it(`@∞ === stringify: ${src.slice(0, 40)}`, async () => {
      const formatted = await fmt(src, WIDE);
      expect(formatted.trimEnd()).toBe(stringify(normAst(src)));
    });
  }
});

describe("canonical two-shape layout", () => {
  const schedule =
    "VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 12 months";

  it("stays compact when it fits", async () => {
    expect(await fmt(schedule, 80)).toMatchInlineSnapshot(`
      "VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 12 months
      "
    `);
  });

  it("expands all clauses when it doesn't fit (VEST alone, FROM aligned)", async () => {
    expect(await fmt(schedule, 40)).toMatchInlineSnapshot(`
      "VEST
        FROM EVENT grant
        OVER 48 months EVERY 1 month
        CLIFF 12 months
      "
    `);
  });

  it("expands selectors independently with the same model", async () => {
    const src =
      "VEST FROM EARLIER OF(EVENT ipo, DATE 2026-01-01) OVER 48 months EVERY 1 month";
    expect(await fmt(src, 30)).toMatchInlineSnapshot(`
      "VEST
        FROM EARLIER OF(
          DATE 2026-01-01,
          EVENT ipo
        )
        OVER 48 months EVERY 1 month
      "
    `);
  });

  it("breaks a program at PLUS, each component deciding for itself", async () => {
    const prog =
      "1/4 VEST CLIFF 12 months PLUS 3/4 VEST FROM EVENT cliff OVER 36 months EVERY 1 month";
    expect(await fmt(prog, 40)).toMatchInlineSnapshot(`
      "1/4 VEST CLIFF 12 months
      PLUS 3/4 VEST
        FROM EVENT cliff
        OVER 36 months EVERY 1 month
      "
    `);
  });
});

describe("the cadence is one unbreakable clause", () => {
  it("never splits OVER…EVERY across lines, even at tiny widths", async () => {
    const out = await fmt(
      "VEST FROM EVENT grant OVER 48 months EVERY 1 month",
      5,
    );
    expect(out).toContain("OVER 48 months EVERY 1 month");
  });
});
