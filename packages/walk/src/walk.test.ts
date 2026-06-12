import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { describe, expect, it } from "vitest";
import {
  forEachChild,
  programInstallmentTotal,
  some,
  walk,
  type AstNode,
  type Path,
} from "./index.js";

// Parse a snippet and run it through the normalizer — forEachChild only knows
// the normalized shape, which is what every real consumer feeds it.
const prog = (dsl: string) => normalizeProgram(parse(dsl));

// The direct children forEachChild reports for one node, as (step, type) pairs.
const childrenOf = (node: AstNode) => {
  const out: { step: string | number; type: string }[] = [];
  forEachChild(node, (child, step) => out.push({ step, type: child.type }));
  return out;
};

// First node of a given type, in walk order (parents before children).
const find = (root: AstNode, type: string): AstNode => {
  let found: AstNode | undefined;
  walk(root, (n) => {
    if (!found && n.type === type) found = n;
  });
  if (!found) throw new Error(`no ${type} node in fixture`);
  return found;
};

describe("forEachChild edge set", () => {
  it("a statement's only child is its expression", () => {
    const stmt = prog(
      "400 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month",
    )[0];
    expect(stmt.type).toBe("STATEMENT");
    expect(childrenOf(stmt)).toEqual([{ step: "expr", type: "SCHEDULE" }]);
  });

  it("a schedule yields its start, and its cliff when present", () => {
    const plain = find(
      prog("400 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month")[0],
      "SCHEDULE",
    );
    expect(childrenOf(plain)).toEqual([
      { step: "vesting_start", type: "NODE" },
    ]);

    const withCliff = find(
      prog(
        "100 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month CLIFF EVENT ipo",
      )[0],
      "SCHEDULE",
    );
    expect(childrenOf(withCliff)).toEqual([
      { step: "vesting_start", type: "NODE" },
      { step: "cliff", type: "NODE" },
    ]);
  });

  it("a vesting node yields its base, and its condition when present", () => {
    const gated = find(
      prog(
        "400 VEST FROM DATE 2024-01-01 BEFORE EVENT ipo OVER 4 months EVERY 1 month",
      )[0],
      "NODE",
    );
    expect(childrenOf(gated)).toEqual([
      { step: "base", type: "DATE" },
      { step: "condition", type: "ATOM" },
    ]);
  });

  it("an ATOM condition yields its constraint", () => {
    const atom = find(
      prog(
        "400 VEST FROM DATE 2024-01-01 BEFORE EVENT ipo OVER 4 months EVERY 1 month",
      )[0],
      "ATOM",
    );
    expect(childrenOf(atom)).toEqual([{ step: "constraint", type: "BEFORE" }]);
  });

  it("a selector yields its arms by index", () => {
    const selector = find(
      prog(
        "400 VEST FROM LATER OF( DATE 2024-01-01, EVENT ipo ) OVER 4 months EVERY 1 month",
      )[0],
      "NODE_LATER_OF",
    );
    expect(childrenOf(selector)).toEqual([
      { step: 0, type: "NODE" },
      { step: 1, type: "NODE" },
    ]);
  });

  it("DATE and EVENT bases are leaves", () => {
    const date = find(
      prog("400 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month")[0],
      "DATE",
    );
    expect(childrenOf(date)).toEqual([]);
  });

  // The edge most worth pinning: a BEFORE/AFTER constraint's reference anchor
  // hangs off `base`, one level deeper than the gated node, so it's the easiest
  // child to miss. An event hidden behind a date gate has to surface here.
  it("descends a BEFORE/AFTER constraint's reference node", () => {
    const before = find(
      prog(
        "400 VEST FROM DATE 2024-01-01 BEFORE EVENT ipo OVER 4 months EVERY 1 month",
      )[0],
      "BEFORE",
    );
    expect(childrenOf(before)).toEqual([{ step: "base", type: "NODE" }]);
  });
});

describe("walk", () => {
  it("enters the root with an empty path and records the trail to each node", () => {
    const stmt = prog(
      "400 VEST FROM DATE 2024-01-01 BEFORE EVENT ipo OVER 4 months EVERY 1 month",
    )[0];

    const seen: { type: string; path: Path }[] = [];
    walk(stmt, (n, path) => seen.push({ type: n.type, path: [...path] }));

    expect(seen[0]).toEqual({ type: "STATEMENT", path: [] });

    // The gating event sits two `base` hops down: the constraint's reference
    // node, then that node's own base.
    const event = seen.find((e) => e.type === "EVENT");
    expect(event?.path).toEqual([
      "expr",
      "vesting_start",
      "condition",
      "constraint",
      "base",
      "base",
    ]);
  });
});

describe("some", () => {
  it("finds an event buried behind a date gate", () => {
    const stmt = prog(
      "400 VEST FROM DATE 2024-01-01 BEFORE EVENT ipo OVER 4 months EVERY 1 month",
    )[0];
    expect(some(stmt, (n) => n.type === "EVENT")).toBe(true);
  });

  it("returns false when no node matches", () => {
    const stmt = prog(
      "400 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month",
    )[0];
    expect(some(stmt, (n) => n.type === "EVENT")).toBe(false);
  });
});

describe("programInstallmentTotal", () => {
  it("reads occurrences off a plain schedule", () => {
    expect(
      programInstallmentTotal(prog("VEST OVER 48 months EVERY 1 month")),
    ).toBe(48);
  });

  it("sums across PLUS statements", () => {
    expect(
      programInstallmentTotal(
        prog(
          "VEST OVER 48 months EVERY 1 month PLUS VEST OVER 12 months EVERY 1 month",
        ),
      ),
    ).toBe(60);
  });

  it("sums a THEN chain's tail into the total", () => {
    expect(
      programInstallmentTotal(
        prog(
          "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month THEN VEST OVER 12 months EVERY 1 month",
        ),
      ),
    ).toBe(60);
  });

  it("takes a schedule selector's largest arm, not the sum", () => {
    expect(
      programInstallmentTotal(
        prog(
          "VEST EARLIER START OF (FROM DATE 2025-01-01 OVER 48 months EVERY 1 month, FROM DATE 2025-06-01 OVER 12 months EVERY 1 month)",
        ),
      ),
    ).toBe(48);
  });
});
