import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateStatement } from "@vestlang/evaluator";
import type {
  EvaluationContextInput,
  Installment,
  OCTDate,
} from "@vestlang/types";

/* ------------------------
 * Helpers
 * ------------------------ */

const date = new Date();
const today = date.toISOString().split("T")[0] as OCTDate;

const createCtx = (grantQuantity: number = 100) =>
  ({
    events: {
      grantDate: today,
      X: today,
    },
    grantQuantity: grantQuantity,
    asOf: today,
    allocation_type: "CUMULATIVE_ROUND_DOWN",
  }) as EvaluationContextInput;

const evaluate = (stmt: string, grantQuantity: number = 100) => {
  const rawProgram = parse(stmt);
  const program = normalizeProgram(rawProgram);
  const expr = program[0];
  const result = evaluateStatement(expr, createCtx(grantQuantity)).installments;
  return result;
};

const shareCount = (installments: Installment[]) => {
  return installments.reduce((acc, installment) => {
    acc += installment.amount;
    return acc;
  }, 0);
};

const getRandomMonths = (): [number, number] => {
  const over = Math.floor(Math.random() * (120 - 6 + 1)) + 6;
  const divisors = Array.from({ length: over }, (_, i) => i + 1).filter(
    (n) => over % n === 0,
  );
  const from = divisors[Math.floor(Math.random() * divisors.length)];
  return [over, from];
};

const getRandomCliff = (over: number, every: number): number => {
  const numInstallments = over / every;
  const cliffIndex = Math.floor(Math.random() * numInstallments);
  return cliffIndex;
};

/* ------------------------
 * Tests
 * ------------------------ */

describe("No events", () => {
  it("4 year monthly vesting", () => {
    const result = evaluate("VEST OVER 4 years EVERY 1 month");
    expect(result.length).toBe(48);
    expect(shareCount(result)).toBe(100);
  });
});

describe("Randomized grantQuantity fuzz test - months", () => {
  const numTrials = 20;
  const min = 1;
  const max = 10000;

  for (let i = 0; i < numTrials; i++) {
    const grantQuantity = Math.floor(Math.random() * (max - min + 1)) + min;
    const [over, every] = getRandomMonths();
    const stmt = `VEST OVER ${over} months EVERY ${every} months`;

    it(`trial ${i + 1}: ${stmt} (${grantQuantity} shares)`, () => {
      const result = evaluate(stmt, grantQuantity);
      const total = shareCount(result);
      expect(total).toBe(grantQuantity);
      expect(result.length).toBe(over / every);
    });

    it(`trial ${i + 1}: ${stmt} (${grantQuantity} shares with cliff)`, () => {
      const cliffIndex = getRandomCliff(over, every);
      const stmtWithCliff =
        cliffIndex > 0 ? stmt + ` CLIFF ${cliffIndex} months` : stmt;
      const result = evaluate(stmtWithCliff, grantQuantity);
      const total = shareCount(result);
      expect(total).toBe(grantQuantity);
    });
  }
});

describe("Randomized grantQuantity fuzz test - days", () => {
  const numTrials = 20;
  const min = 1;
  const max = 10000;

  for (let i = 0; i < numTrials; i++) {
    const grantQuantity = Math.floor(Math.random() * (max - min + 1)) + min;
    const [over, every] = getRandomMonths();
    const stmt = `VEST OVER ${over} days EVERY ${every} days`;

    it(`trial ${i + 1}: ${stmt} (${grantQuantity} shares)`, () => {
      const result = evaluate(stmt, grantQuantity);
      const total = shareCount(result);
      expect(total).toBe(grantQuantity);
      expect(result.length).toBe(over / every);
    });

    it(`trial ${i + 1}: ${stmt} (${grantQuantity} shares with cliff)`, () => {
      const cliffIndex = getRandomCliff(over, every);
      const stmtWithCliff =
        cliffIndex > 0 ? stmt + ` CLIFF ${cliffIndex} days` : stmt;
      const result = evaluate(stmtWithCliff, grantQuantity);
      const total = shareCount(result);
      expect(total).toBe(grantQuantity);
    });
  }
});
