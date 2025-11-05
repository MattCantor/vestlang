import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateStatement } from "@vestlang/evaluator";
import type { EvaluationContextInput, OCTDate, Tranche } from "@vestlang/types";

/* ------------------------
 * Helpers
 * ------------------------ */

const date = new Date();
const today = date.toISOString().split("T")[0] as OCTDate;

const datePlus1 = new Date(date);
datePlus1.setDate(date.getDate() + 1);
const tomorrow = datePlus1.toISOString().split("T")[0] as OCTDate;

const dateMinus1 = new Date(date);
dateMinus1.setDate(date.getDate() - 1);
const yesterday = dateMinus1.toISOString().split("T")[0] as OCTDate;

// EVENT X BEFORE EVENT A -> TRUE when A > X
const eventTrue = (event: string) => ({
  [event]: tomorrow,
});

const eventFalse = (event: string) => ({
  [event]: yesterday,
});

const ctx_input: EvaluationContextInput = {
  events: {
    grantDate: today,
    X: today,
  },
  grantQuantity: 100,
  asOf: today,
  allocation_type: "CUMULATIVE_ROUND_DOWN",
};

const evaluate = (stmt: string, events: Record<string, OCTDate>) => {
  const statement = `${base} ${stmt}`;
  const ctx = {
    ...ctx_input,
    events: {
      ...ctx_input.events,
      ...events,
    },
  };

  const rawProgram = parse(statement);
  const program = normalizeProgram(rawProgram);
  const expr = program[0];
  const result = evaluateStatement(expr, ctx);
  return result;
};

const base = "VEST FROM EVENT X ";

const expectedFalse = (result: Tranche[]) => {
  expect(result.length).toBe(1);
  expect(result[0].amount).toBe(100);
  expect(result[0].meta.state).toBe("IMPOSSIBLE");
};

const expectedTrue = (result: Tranche[]) => {
  expect(result.length).toBe(1);
  expect(result[0].amount).toBe(100);
  expect(result[0].meta.state).toBe("RESOLVED");
};

/* ------------------------
 * Tests
 * ------------------------ */

describe("AND tighter than OR in 'A OR B AND C'", () => {
  const s1 = "BEFORE EVENT A OR BEFORE EVENT B AND BEFORE EVENT C";
  const s2 = "OR(BEFORE EVENT A, BEFORE EVENT B) AND BEFORE EVENT C";

  describe("FALSE OR FALSE AND FALSE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventFalse("B"),
      ...eventFalse("C"),
    };

    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedFalse(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("FALSE OR FALSE AND TRUE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventFalse("B"),
      ...eventTrue("C"),
    };

    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedFalse(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("FALSE OR TRUE AND FALSE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventTrue("B"),
      ...eventFalse("C"),
    };

    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedFalse(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("FALSE OR TRUE AND TRUE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventTrue("B"),
      ...eventTrue("C"),
    };

    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedTrue(result);
    });
  });

  describe("TRUE OR FALSE AND FALSE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventFalse("B"),
      ...eventFalse("C"),
    };

    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("TRUE OR FALSE AND TRUE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventFalse("B"),
      ...eventTrue("C"),
    };
    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedTrue(result);
    });
  });

  describe("TRUE OR TRUE AND FALSE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventTrue("B"),
      ...eventFalse("C"),
    };
    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("TRUE OR TRUE AND TRUE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventTrue("B"),
      ...eventTrue("C"),
    };

    it("A OR B AND C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("OR(A, B) AND C", () => {
      const result = evaluate(s2, events);
      expectedTrue(result);
    });
  });
});

describe("AND tighter than OR in 'A AND B OR C'", () => {
  const s1 = "BEFORE EVENT A AND BEFORE EVENT B OR BEFORE EVENT C";
  const s2 = "BEFORE EVENT A AND OR(BEFORE EVENT B, BEFORE EVENT C)";

  describe("FALSE OR FALSE AND FALSE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventFalse("B"),
      ...eventFalse("C"),
    };

    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedFalse(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("FALSE OR FALSE AND TRUE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventFalse("B"),
      ...eventTrue("C"),
    };

    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("FALSE OR TRUE AND FALSE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventTrue("B"),
      ...eventFalse("C"),
    };

    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedFalse(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("FALSE OR TRUE AND TRUE", () => {
    const events = {
      ...eventFalse("A"),
      ...eventTrue("B"),
      ...eventTrue("C"),
    };

    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("TRUE OR FALSE AND FALSE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventFalse("B"),
      ...eventFalse("C"),
    };

    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedFalse(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedFalse(result);
    });
  });

  describe("TRUE OR FALSE AND TRUE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventFalse("B"),
      ...eventTrue("C"),
    };

    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedTrue(result);
    });
  });

  describe("TRUE OR TRUE AND FALSE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventTrue("B"),
      ...eventFalse("C"),
    };
    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedTrue(result);
    });
  });

  describe("TRUE OR TRUE AND TRUE", () => {
    const events = {
      ...eventTrue("A"),
      ...eventTrue("B"),
      ...eventTrue("C"),
    };

    it("A AND B OR C", () => {
      const result = evaluate(s1, events);
      expectedTrue(result);
    });

    it("A, OR(B, C)", () => {
      const result = evaluate(s2, events);
      expectedTrue(result);
    });
  });
});
