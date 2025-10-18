import { describe, it, expect } from "vitest";
import { normalizeProgram } from "../src/normalizer/index.js";
import type {
  AndCondition,
  AtomCondition,
  ConstrainedVestingNode,
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

/** Throw error if the first statement is not a singleton */
function getSingleton(program: Program) {
  const stmt = program[0];
  if (!stmt || stmt.expr.type !== "SINGLETON") {
    throw new Error("Expected first statement to be a SINGLETON");
  }
  return stmt.expr;
}

/** Getter for vesting_start expression (bare/constrained or selector) */
function getVestingStartItems(p: Program) {
  const vesting_start = getSingleton(p).vesting_start;
  return vesting_start &&
    (vesting_start.type === "EARLIER_OF" || vesting_start.type === "LATER_OF")
    ? vesting_start.items
    : [];
}

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
    expect(
      items.every((x: any) => x.type === "BARE" || x.type === "CONSTRAINED"),
    ).toBe(true);
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
      vesting_start.type === "LATER_OF" || vesting_start.type === "EARLIER_OF",
    ).toBe(false);
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
    if (vesting_start.type !== "CONSTRAINED") {
      throw new Error("Expected vesting start to be constrainted");
    }
    const c = (vesting_start as ConstrainedVestingNode).constraints;

    // After dedupe, AND has 1 item -> collapses to that item (ATOM)
    expect(c.type).toBe("ATOM");
    expect((c as AtomCondition).constraint.type).toBe("BEFORE");
    expect((c as AtomCondition).constraint.base.type).toBe("BARE");
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
    expect(vs.type).toBe("CONSTRAINED");
    const c = (vs as ConstrainedVestingNode).constraints;
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
    expect(vs.type).toBe("LATER_OF");
    expect((vs as LaterOfVestingNode).items.length).toBe(2);
    // Top-level items are vesting nodes (selector was flattened)
    expect(
      (vs as LaterOfVestingNode).items.every(
        (x: any) => x.type === "BARE" || x.type === "CONSTRAINED",
      ),
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
    expect(vs.type === "LATER_OF" || vs.type === "EARLIER_OF").toBe(false);
    expect(vs.type === "BARE" || vs.type === "CONSTRAINED").toBe(true);
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
    expect(cliff!.type === "EARLIER_OF" || cliff!.type === "LATER_OF").toBe(
      false,
    );
    expect(cliff!.type === "BARE" || cliff!.type === "CONSTRAINED").toBe(true);
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
    const twice = normalizeProgram(once as Program);

    // Property check: this is the real idempotence assertion.
    expect(twice).toEqual(once);

    // Optional: snapshot for human-friendly regression diff.
    expect(once).toMatchSnapshot();
  });
});
