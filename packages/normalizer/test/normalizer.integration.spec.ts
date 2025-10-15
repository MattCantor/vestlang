import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl"; // adjust if your parse lives elsewhere
import { normalizeProgram } from "../dist/normalizer/index.js";

function norm(src: string) {
  const ast = parse(src) as any[]; // parser returns ASTStatement[]
  return normalizeProgram(ast);
}

describe("normalizer – integration (parser + normalizer)", () => {
  // it("canonicalizes offsets: sum per unit, explicit sign, drop zeros", () => {
  //   const [s] = norm(`VEST FROM EVENT a + 2 months - 1 months + 10 days`);
  //   const start = (s as any).expr.vesting_start;
  //   expect(start.type).toBe("BARE");
  //   expect(start.offsets).toEqual([
  //     { type: "DURATION", value: 1, unit: "MONTHS", sign: "PLUS" },
  //     { type: "DURATION", value: 10, unit: "DAYS", sign: "PLUS" },
  //   ]);
  // });

  it("flattens & dedupes EARLIER_OF and sorts deterministically", () => {
    const [s] = norm(`
      VEST FROM EARLIER OF (
        EVENT b,
        EARLIER OF ( EVENT a, EVENT b )
      )
    `);
    const start = (s as any).expr.vesting_start;
    expect(start.type).toBe("EARLIER_OF");
    // sorted & deduped to [a, b]
    const bases = start.items.map((n: any) => n.base.value);
    expect(bases).toEqual(["a", "b"]);
  });

  it("hoists constraints out of ATOM bases (no ATOM has CONSTRAINED base)", () => {
    const [s] = norm(`
      VEST FROM EVENT origin BEFORE EVENT b AND AND( BEFORE EVENT c, AFTER EVENT d )
    `);
    const constraints = (s as any).expr.vesting_start.constraints;
    const visit = (n: any) => {
      if (!n) return;
      if (n.type === "ATOM") {
        // base must be a BARE vesting node after normalization
        expect(n.constraint.base.type).toBe("BARE");
      } else if (n.type === "AND" || n.type === "OR") {
        expect(Array.isArray(n.items)).toBe(true);
        n.items.forEach(visit);
      }
    };
    visit(constraints);
  });

  it("collapses boolean singletons: AND(x) => x, OR(x) => x", () => {
    const [s] = norm(`
      VEST FROM EVENT a ( AND( BEFORE EVENT b ) )
    `);
    const constraints = (s as any).expr.vesting_start.constraints;
    // top-level should be ATOM now (not an AND wrapper)
    expect(constraints.type).toBe("ATOM");
  });

  it("deterministically normalizes equivalent but differently ordered inputs", () => {
    const [s1] = norm(`
      VEST FROM EARLIER OF ( EVENT b, EVENT a, EVENT c, EVENT b )
    `);
    const [s2] = norm(`
      VEST FROM EARLIER OF ( EVENT c, EARLIER OF ( EVENT a, EVENT b ) )
    `);
    expect(s1).toEqual(s2);
  });

  it("keeps schedule periodicity intact (normalizer doesn't change it)", () => {
    const [s] = norm(`VEST FROM EVENT a OVER 12 months EVERY 3 months`);
    const p = (s as any).expr.periodicity;
    expect(p).toEqual({
      type: "MONTHS",
      length: 3,
      occurrences: 4,
    });
  });
});
