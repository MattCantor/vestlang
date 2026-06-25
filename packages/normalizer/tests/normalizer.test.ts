import { describe, it, expect } from "vitest";
import { normalizeProgram } from "../src/normalizer/index.js";
import type {
  AndCondition,
  AtomCondition,
  EarlierOfVestingNode,
  LaterOfVestingNode,
  Program,
} from "@vestlang/types";
import { parse } from "@vestlang/dsl";

/* ------------------------
 * Helpers
 * ------------------------ */

function norm(src: string): Program {
  const ast = parse(src);
  return normalizeProgram(ast);
}

/** Throw error if the first statement is not a single schedule (and not a
 *  chained tail, which carries no start of its own — these tests never use one). */
function getSingleton(program: Program) {
  const stmt = program[0];
  if (!stmt || stmt.chained || stmt.expr.type !== "SCHEDULE") {
    throw new Error("Expected first statement to be a single SCHEDULE");
  }
  return stmt.expr;
}

/** Getter for vesting_start expression (bare/constrained or selector) */
function getVestingStartItems(p: Program) {
  const vesting_start = getSingleton(p).vesting_start;
  return vesting_start &&
    (vesting_start.type === "NODE_EARLIER_OF" ||
      vesting_start.type === "NODE_LATER_OF")
    ? vesting_start.items
    : [];
}

/* ------------------------
 * Applies defaults
 * ------------------------ */

describe("Produces default", () => {
  it("Produces default grantDate event from null vesting_start", () => {
    const out = norm("VEST");
    if (out[0].expr.type !== "SCHEDULE")
      throw new Error(
        `Expected ${JSON.stringify(out[0].expr, null, 2)} to have type "SCHEDULE"`,
      );
    const vs = out[0].expr.vesting_start;
    expect(vs).toEqual({
      type: "NODE",
      base: { type: "GRANT_DATE" },
      offsets: [],
    });
  });
  it("Produces default vestingStart event from cliff with duration", () => {
    const out = norm("VEST CLIFF 6 months");
    if (out[0].expr.type !== "SCHEDULE")
      throw new Error(
        `Expected ${JSON.stringify(out[0].expr, null, 2)} to have type "SCHEDULE"`,
      );
    const cliff = out[0].expr.periodicity.cliff;
    if (cliff?.type !== "NODE")
      throw new Error(
        `Expected ${JSON.stringify(out[0].expr, null, 2)} cliff to have type "NODE"`,
      );
    expect(cliff.base).toEqual({ type: "VESTING_START" });
  });
});

/* ------------------------
 * Selectors
 * ------------------------ */

describe("selectors: flatten, dedupe, collapse", () => {
  it("flattens nested LATER OF and dedupes identical items", () => {
    const out = norm(`
    VEST FROM
      LATER OF(
        EVENT a + 1 day,
        LATER OF(
          EVENT a + 1 day,
          DATE 2025-01-01
        )
      )
    OVER 12 months
    EVERY 1 month
`);
    const items = getVestingStartItems(out);

    // Should flatten to two unique items after dedupe
    expect(items.length).toBe(2);

    // Ensure there is no nested selector remaining at top-level items
    expect(items.every((x) => x.type === "NODE")).toBe(true);
  });

  it("collapses to singleton after dedupe when both items are identical", () => {
    const out = norm(`
      VEST FROM
        LATER OF(
          EVENT a,
          EVENT a
        )
    `);

    // After normalization, vesting_start should not be a selector anymore
    const vesting_start = getSingleton(out).vesting_start;
    expect(
      vesting_start.type === "NODE_LATER_OF" ||
        vesting_start.type === "NODE_EARLIER_OF",
    ).toBe(false);
  });
});

/** Read the base name (event/date value) of each selector item, for order checks. */
function itemBaseValues(p: Program): (string | undefined)[] {
  return getVestingStartItems(p).map((item) => {
    if (item.type !== "NODE") return undefined;
    return "value" in item.base ? item.base.value : item.base.type;
  });
}

describe("selectors: authored order preserved", () => {
  it("does not sort operands", () => {
    const out = norm(
      "VEST FROM EARLIER OF (EVENT zebra, EVENT apple, DATE 2025-06-01, EVENT mango) OVER 12 months EVERY 1 month",
    );
    expect(itemBaseValues(out)).toEqual([
      "zebra",
      "apple",
      "2025-06-01",
      "mango",
    ]);
  });

  it("dedupe keeps the first occurrence in place", () => {
    const out = norm("VEST FROM LATER OF (EVENT b, EVENT a, EVENT b)");
    expect(itemBaseValues(out)).toEqual(["b", "a"]);
  });
});

/* ------------------------
 * Constraints
 * ------------------------ */

// Duplicate AND constraints collapse into a single ATOM
describe("constraints: dedupe + singleton collapse", () => {
  it("AND(BEFORE b, BEFORE b) -> ATOM(BEFORE B)", () => {
    const out = norm(`
      VEST FROM EVENT start
        BEFORE EVENT b + 2 days
        AND BEFORE EVENT b + 2 days
    `);

    const vesting_start = getSingleton(out).vesting_start;
    if (vesting_start.type !== "NODE") {
      throw new Error(
        `Expected ${JSON.stringify(vesting_start)} start to be constrainted`,
      );
    }
    if (!vesting_start.condition)
      throw new Error(
        `Expected ${JSON.stringify(vesting_start)} to have constraints`,
      );
    const c = vesting_start.condition;

    // After dedupe, AND has 1 item -> collapses to that item (ATOM)
    expect(c.type).toBe("ATOM");
    expect((c as AtomCondition).constraint.type).toBe("BEFORE");
    expect((c as AtomCondition).constraint.base.type).toBe("NODE");
  });
});

/** nested AND(...) flattens to a single AND with 3 items (no dedupe). */
describe("constraints: flatten AND", () => {
  it("AND(BEFORE a, AND(BEFORE b, BEFORE c)) → AND(BEFORE a, BEFORE b, BEFORE c)", () => {
    const out = norm(`
      VEST FROM EVENT start
          AND(
            BEFORE EVENT a,
            AND(
              BEFORE EVENT b,
              BEFORE EVENT c
            )
          )
    `);

    const vs = getSingleton(out).vesting_start;
    if (vs.type !== "NODE")
      throw new Error(`Expected ${JSON.stringify(vs)} type to be "NODE"`);
    if (!vs.condition)
      throw new Error(`Expected ${JSON.stringify(vs)} to have constraints`);
    const c = vs.condition;
    expect(c.type).toBe("AND");
    expect((c as AndCondition).items.length).toBe(3);
    // Sanity: each item is an ATOM constraint
    expect((c as AndCondition).items.every((x) => x.type === "ATOM")).toBe(
      true,
    );
  });
});

/** LATER OF with nested LATER OF flattens and dedupes to 2 unique items. */
describe("selectors (vesting_start): flatten + dedupe", () => {
  it("LATER OF(a, LATER OF(a, date)) → LATER_OF(a, date)", () => {
    const out = norm(`
      VEST
        FROM LATER OF(
          EVENT a + 1 day,
          LATER OF(
            EVENT a + 1 day,
            DATE 2025-01-01
          )
        )
    `);

    const vs = getSingleton(out).vesting_start;
    expect(vs.type).toBe("NODE_LATER_OF");
    expect((vs as LaterOfVestingNode).items.length).toBe(2);
    // Top-level items are vesting nodes (selector was flattened)
    expect(
      (vs as LaterOfVestingNode).items.every((x) => x.type === "NODE"),
    ).toBe(true);
  });
});

/** LATER OF(dup, dup) collapses to bare node. */
describe("selectors (vesting_start): singleton collapse", () => {
  it("LATER OF(m1, m1) → m1", () => {
    const out = norm(`
      VEST FROM LATER OF( EVENT m1, EVENT m1 )
    `);

    const vs = getSingleton(out).vesting_start;
    expect(vs.type === "NODE_LATER_OF" || vs.type === "NODE_EARLIER_OF").toBe(
      false,
    );
    expect(vs.type === "NODE").toBe(true);
  });
});

/** Focus: EARLIER OF(date, same date) collapses to single node in cliff. */
describe("cliff: selector dedupe + collapse", () => {
  it("EARLIER OF(d, d) → d inside CLIFF", () => {
    const out = norm(`
      VEST FROM EVENT start
        OVER 12 months EVERY 1 month
        CLIFF EARLIER OF(
          DATE 2026-01-01,
          DATE 2026-01-01
        )
    `);

    const cliff = getSingleton(out).periodicity.cliff;
    expect(cliff).toBeTruthy();
    // After dedupe, selector collapses to node
    expect(
      cliff!.type === "NODE_EARLIER_OF" || cliff!.type === "NODE_LATER_OF",
    ).toBe(false);
    expect(cliff!.type === "NODE").toBe(true);
  });
});

/* ------------------------
 * #460: bare multi-term offset selector arm anchors per slot
 * ------------------------ */

describe("bare multi-term offset selector arm (#460)", () => {
  // The carrier (DURATION_OFFSETS) is a raw normalizer input — gone post-normalize.
  // Each test normalizes the bare form AND its written-out anchored equivalent and
  // asserts deep equality: the anchored form normalizes to itself idempotently, so
  // comparing both-normalized is the phase-correct check that the bare arm anchors to
  // exactly the same NODE the author would have written out.

  it("bare FROM arm normalizes to the grant-date-anchored NODE, deep-equal to written-out", () => {
    const bare = getSingleton(
      norm(
        "VEST FROM EARLIER OF (+20 days +1 month, EVENT a) OVER 4 years EVERY 1 month",
      ),
    ).vesting_start;
    const anchored = getSingleton(
      norm(
        "VEST FROM EARLIER OF (grantDate + 20 days + 1 month, EVENT a) OVER 4 years EVERY 1 month",
      ),
    ).vesting_start;

    expect(bare).toEqual(anchored);
    expect(bare).toEqual({
      type: "NODE_EARLIER_OF",
      items: [
        {
          type: "NODE",
          base: { type: "GRANT_DATE" },
          offsets: [
            { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
            { type: "DURATION", value: 20, unit: "DAYS", sign: "PLUS" },
          ],
        },
        { type: "NODE", base: { type: "EVENT", value: "a" }, offsets: [] },
      ],
    });
    // The carrier tag must not survive normalization.
    expect(JSON.stringify(bare)).not.toContain("DURATION_OFFSETS");
  });

  it("works under a CLIFF slot (vesting-start anchor), deep-equal to written-out", () => {
    const bare = getSingleton(
      norm(
        "VEST OVER 12 months EVERY 1 month CLIFF EARLIER OF (+20 days +1 month, EVENT a)",
      ),
    ).periodicity.cliff;
    const anchored = getSingleton(
      norm(
        "VEST OVER 12 months EVERY 1 month CLIFF EARLIER OF (vestingStart + 20 days + 1 month, EVENT a)",
      ),
    ).periodicity.cliff;

    expect(bare).toEqual(anchored);
    // Same arm text, different anchor per slot — the core design point.
    expect(bare).toEqual({
      type: "NODE_EARLIER_OF",
      items: [
        {
          type: "NODE",
          base: { type: "VESTING_START" },
          offsets: [
            { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
            { type: "DURATION", value: 20, unit: "DAYS", sign: "PLUS" },
          ],
        },
        { type: "NODE", base: { type: "EVENT", value: "a" }, offsets: [] },
      ],
    });
  });

  it("anchors through nesting (depth >= 2 inside an outer selector)", () => {
    const bare = getSingleton(
      norm(
        "VEST FROM LATER OF (EVENT x, EARLIER OF (+20 days +1 month, EVENT a)) OVER 4 years EVERY 1 month",
      ),
    ).vesting_start;
    const anchored = getSingleton(
      norm(
        "VEST FROM LATER OF (EVENT x, EARLIER OF (grantDate + 20 days + 1 month, EVENT a)) OVER 4 years EVERY 1 month",
      ),
    ).vesting_start;

    expect(bare).toEqual(anchored);
    // The outer node is a LATER OF; its second item is an EARLIER OF whose first arm
    // is the grant-date-anchored NODE — the carrier is reached and anchored through
    // nesting, not just as a top-level selector peer.
    expect(bare.type).toBe("NODE_LATER_OF");
    const outer = bare as LaterOfVestingNode;
    const inner = outer.items[1];
    expect(inner.type).toBe("NODE_EARLIER_OF");
    expect((inner as EarlierOfVestingNode<"GRANT_DATE">).items[0]).toEqual({
      type: "NODE",
      base: { type: "GRANT_DATE" },
      offsets: [
        { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
        { type: "DURATION", value: 20, unit: "DAYS", sign: "PLUS" },
      ],
    });
  });

  it("no regression — single-term bare arm anchors via the existing DURATION case", () => {
    const vs = getSingleton(
      norm(
        "VEST FROM EARLIER OF (+3 months, EVENT a) OVER 4 years EVERY 1 month",
      ),
    ).vesting_start as EarlierOfVestingNode<"GRANT_DATE">;
    expect(vs.items[0]).toEqual({
      type: "NODE",
      base: { type: "GRANT_DATE" },
      offsets: [{ type: "DURATION", value: 3, unit: "MONTHS", sign: "PLUS" }],
    });
  });
});

/* ------------------------
 * #475: top-level bare multi-term offset anchors per slot
 * ------------------------ */

describe("top-level bare multi-term offset anchors per slot (#475)", () => {
  // A top-level `FROM +20d +1mo` / `CLIFF 20d +1mo` used to anchor at parse time via
  // the #459 grammar wrappers. #475 retired those: the bare form now parses to the
  // same DURATION_OFFSETS carrier the selector arms use and normalizeNode anchors it
  // per slot. The behavior-preservation bar is that the normalized output stays
  // byte-identical to the written-out anchored form. (These equivalences moved here
  // from the parser suite, where they no longer hold at parse — see parser.spec.ts.)

  it("bare FROM offset normalizes to the grant-date-anchored NODE, deep-equal to written-out", () => {
    const bare = getSingleton(
      norm("VEST FROM +20 days +1 month"),
    ).vesting_start;
    const anchored = getSingleton(
      norm("VEST FROM grantDate + 20 days + 1 month"),
    ).vesting_start;

    expect(bare).toEqual(anchored);
    expect(bare).toEqual({
      type: "NODE",
      base: { type: "GRANT_DATE" },
      offsets: [
        { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
        { type: "DURATION", value: 20, unit: "DAYS", sign: "PLUS" },
      ],
    });
    // The carrier tag must not survive normalization.
    expect(JSON.stringify(bare)).not.toContain("DURATION_OFFSETS");
  });

  it("bare CLIFF offset normalizes to the vesting-start-anchored NODE, deep-equal to written-out", () => {
    const bare = getSingleton(
      norm("VEST OVER 12 months EVERY 1 month CLIFF 20 days + 1 month"),
    ).periodicity.cliff;
    const anchored = getSingleton(
      norm(
        "VEST OVER 12 months EVERY 1 month CLIFF vestingStart + 20 days + 1 month",
      ),
    ).periodicity.cliff;

    expect(bare).toEqual(anchored);
    expect(bare).toEqual({
      type: "NODE",
      base: { type: "VESTING_START" },
      offsets: [
        { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
        { type: "DURATION", value: 20, unit: "DAYS", sign: "PLUS" },
      ],
    });
    expect(JSON.stringify(bare)).not.toContain("DURATION_OFFSETS");
  });
});

/* ------------------------
 * Idempotence
 * ------------------------ */

describe("normalize is idempotent", () => {
  it("normalize(normalize(parse(src))) === normalize(parse(src))", () => {
    const src = `
      VEST FROM
        LATER OF(
          EVENT x + 1 month,
          LATER OF( DATE 2025-01-01, DATE 2025-01-01 )
        )
      OVER 12 months
      EVERY 1 month
    `;

    const once = norm(src);
    console.log("once", JSON.stringify(once, null, 2));
    const twice = normalizeProgram(once as unknown as Program<"raw">);
    console.log("twice", JSON.stringify(twice, null, 2));

    // Property check: this is the real idempotence assertion.
    expect(twice).toEqual(once);

    // Optional: snapshot for human-friendly regression diff.
    expect(once).toMatchSnapshot();
  });
});
