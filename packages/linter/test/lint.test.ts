import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { lintProgram } from "../src/index.js";
import type { RawProgram } from "@vestlang/types";

function diagnosticsOf(src: string) {
  const raw = parse(src) as RawProgram;
  const program = normalizeProgram(raw);
  return lintProgram(program).diagnostics;
}

describe("@vestlang/linter", () => {
  describe("lintProgram", () => {
    it("returns empty diagnostics for valid normalized programs", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant OVER 12 months EVERY 1 month
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles selectors (EARLIER OF)", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EARLIER OF (DATE 2025-01-01, DATE 2025-06-01)
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles selectors (LATER OF)", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM LATER OF (EVENT ipo, EVENT acquisition)
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles top-level schedule selectors", () => {
      const diagnostics = diagnosticsOf(`
        VEST EARLIER OF (
          FROM DATE 2025-01-01,
          FROM DATE 2025-06-01
        )
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles constraints with AND/OR", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant BEFORE DATE 2025-12-31 AND AFTER DATE 2025-01-01
      `);
      expect(diagnostics).toEqual([]);
    });

    it("handles complex programs with cliff", () => {
      const diagnostics = diagnosticsOf(`
        VEST FROM EVENT grant OVER 48 months EVERY 1 month CLIFF 1 year
      `);
      expect(diagnostics).toEqual([]);
    });
  });
});
