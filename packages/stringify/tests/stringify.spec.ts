import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type { Program } from "@vestlang/types";
import { stringify, stringifyStatement, stringifyProgram } from "../src/index.js";

/* ------------------------
 * Helpers
 * ------------------------ */

function roundTrip(src: string): string {
  const ast = parse(src);
  const normalized = normalizeProgram(ast);
  return stringify(normalized);
}

function norm(src: string): Program {
  return normalizeProgram(parse(src));
}

/* ------------------------
 * Basic Statements
 * ------------------------ */

describe("basic statements", () => {
  it("stringifies bare VEST", () => {
    const result = roundTrip("VEST");
    expect(result).toBe("VEST");
  });

  it("stringifies VEST with quantity amount", () => {
    const result = roundTrip("100 VEST");
    expect(result).toBe("100 VEST");
  });

  it("stringifies VEST with portion amount", () => {
    const result = roundTrip("1/4 VEST");
    expect(result).toBe("1/4 VEST");
  });

  it("omits default 1/1 portion", () => {
    const result = roundTrip("1/1 VEST");
    expect(result).toBe("VEST");
  });
});

/* ------------------------
 * FROM clause
 * ------------------------ */

describe("FROM clause", () => {
  it("omits default FROM EVENT grantDate", () => {
    const result = roundTrip("VEST FROM EVENT grantDate");
    expect(result).toBe("VEST");
  });

  it("includes non-default FROM EVENT", () => {
    const result = roundTrip("VEST FROM EVENT customEvent");
    expect(result).toBe("VEST FROM EVENT customEvent");
  });

  it("includes FROM DATE", () => {
    const result = roundTrip("VEST FROM DATE 2025-01-15");
    expect(result).toBe("VEST FROM DATE 2025-01-15");
  });

  it("includes FROM with offsets", () => {
    const result = roundTrip("VEST FROM EVENT grantDate + 1 month");
    expect(result).toBe("VEST FROM EVENT grantDate +1 months");
  });

  it("includes FROM with negative offset", () => {
    const result = roundTrip("VEST FROM EVENT grantDate - 5 days");
    expect(result).toBe("VEST FROM EVENT grantDate -5 days");
  });

  it("includes FROM with month and day offsets", () => {
    const result = roundTrip("VEST FROM EVENT start + 2 months + 15 days");
    expect(result).toBe("VEST FROM EVENT start +2 months +15 days");
  });
});

/* ------------------------
 * Periodicity (OVER/EVERY)
 * ------------------------ */

describe("periodicity", () => {
  it("stringifies OVER/EVERY in months", () => {
    const result = roundTrip("VEST OVER 48 months EVERY 1 month");
    expect(result).toBe("VEST OVER 48 months EVERY 1 months");
  });

  it("stringifies OVER/EVERY in days", () => {
    const result = roundTrip("VEST OVER 365 days EVERY 1 day");
    expect(result).toBe("VEST OVER 365 days EVERY 1 days");
  });

  it("stringifies periodic vesting with 3 month intervals", () => {
    const result = roundTrip("VEST OVER 12 months EVERY 3 months");
    expect(result).toBe("VEST OVER 12 months EVERY 3 months");
  });
});

/* ------------------------
 * CLIFF
 * ------------------------ */

describe("cliff", () => {
  it("stringifies cliff with duration (normalized to vestingStart + offset)", () => {
    const result = roundTrip("VEST CLIFF 12 months");
    // Duration cliffs are normalized to EVENT vestingStart + offset
    expect(result).toBe("VEST CLIFF EVENT vestingStart +12 months");
  });

  it("stringifies cliff with explicit vesting node", () => {
    const result = roundTrip("VEST CLIFF EVENT customCliff");
    expect(result).toBe("VEST CLIFF EVENT customCliff");
  });

  it("stringifies cliff with date", () => {
    const result = roundTrip("VEST CLIFF DATE 2026-01-01");
    expect(result).toBe("VEST CLIFF DATE 2026-01-01");
  });
});

/* ------------------------
 * Constraints
 * ------------------------ */

describe("constraints", () => {
  it("stringifies BEFORE constraint", () => {
    const result = roundTrip("VEST FROM EVENT start BEFORE EVENT deadline");
    expect(result).toBe("VEST FROM EVENT start BEFORE EVENT deadline");
  });

  it("stringifies AFTER constraint", () => {
    const result = roundTrip("VEST FROM EVENT start AFTER EVENT minimum");
    expect(result).toBe("VEST FROM EVENT start AFTER EVENT minimum");
  });

  it("stringifies STRICTLY BEFORE constraint", () => {
    const result = roundTrip("VEST FROM EVENT start STRICTLY BEFORE EVENT deadline");
    expect(result).toBe("VEST FROM EVENT start STRICTLY BEFORE EVENT deadline");
  });

  it("stringifies AND constraints", () => {
    const result = roundTrip("VEST FROM EVENT start AND(BEFORE EVENT a, AFTER EVENT b)");
    expect(result).toBe("VEST FROM EVENT start AND(BEFORE EVENT a, AFTER EVENT b)");
  });

  it("stringifies OR constraints", () => {
    const result = roundTrip("VEST FROM EVENT start OR(BEFORE EVENT a, BEFORE EVENT b)");
    expect(result).toBe("VEST FROM EVENT start OR(BEFORE EVENT a, BEFORE EVENT b)");
  });
});

/* ------------------------
 * Selectors (LATER OF / EARLIER OF)
 * ------------------------ */

describe("selectors", () => {
  it("stringifies LATER OF for vesting start", () => {
    const result = roundTrip("VEST FROM LATER OF(EVENT a, EVENT b)");
    expect(result).toBe("VEST FROM LATER OF(EVENT a, EVENT b)");
  });

  it("stringifies EARLIER OF for vesting start", () => {
    const result = roundTrip("VEST FROM EARLIER OF(DATE 2025-01-01, EVENT start)");
    expect(result).toBe("VEST FROM EARLIER OF(DATE 2025-01-01, EVENT start)");
  });

  it("stringifies nested selectors (flattened after normalization)", () => {
    const result = roundTrip(`
      VEST FROM LATER OF(
        EVENT a,
        LATER OF(EVENT b, EVENT c)
      )
    `);
    // After normalization, nested LATER OF is flattened
    expect(result).toBe("VEST FROM LATER OF(EVENT a, EVENT b, EVENT c)");
  });

  it("collapses duplicate selector items", () => {
    const result = roundTrip("VEST FROM LATER OF(EVENT a, EVENT a)");
    // After normalization, duplicates are removed, collapsing to singleton
    expect(result).toBe("VEST FROM EVENT a");
  });
});

/* ------------------------
 * Schedule Selectors
 * ------------------------ */

describe("schedule selectors", () => {
  it("stringifies LATER OF for schedules", () => {
    const result = roundTrip(`
      VEST LATER OF(
        FROM EVENT a OVER 12 months EVERY 1 month,
        FROM EVENT b OVER 24 months EVERY 1 month
      )
    `);
    expect(result).toBe("VEST LATER OF(FROM EVENT a OVER 12 months EVERY 1 months, FROM EVENT b OVER 24 months EVERY 1 months)");
  });
});

/* ------------------------
 * Complex Examples
 * ------------------------ */

describe("complex examples", () => {
  it("stringifies full vesting schedule", () => {
    const result = roundTrip(`
      VEST FROM EVENT grant
        OVER 48 months EVERY 1 month
        CLIFF 12 months
    `);
    expect(result).toBe("VEST FROM EVENT grant OVER 48 months EVERY 1 months CLIFF EVENT vestingStart +12 months");
  });

  it("stringifies vesting with constraints and offset", () => {
    const result = roundTrip(`
      VEST FROM EVENT start + 1 month
        BEFORE EVENT deadline
        OVER 24 months EVERY 1 month
    `);
    expect(result).toBe("VEST FROM EVENT start +1 months BEFORE EVENT deadline OVER 24 months EVERY 1 months");
  });
});

/* ------------------------
 * Multiple Statements (Program)
 * ------------------------ */

describe("program (multiple statements)", () => {
  it("stringifies program with multiple statements", () => {
    const result = roundTrip(`[
      1/4 VEST CLIFF 12 months,
      3/4 VEST FROM EVENT cliff OVER 36 months EVERY 1 month
    ]`);
    expect(result).toBe("[ 1/4 VEST CLIFF EVENT vestingStart +12 months, 3/4 VEST FROM EVENT cliff OVER 36 months EVERY 1 months ]");
  });
});

/* ------------------------
 * API Tests
 * ------------------------ */

describe("API", () => {
  it("stringify accepts Statement", () => {
    const program = norm("100 VEST");
    const statement = program[0];
    const result = stringify(statement);
    expect(result).toBe("100 VEST");
  });

  it("stringify accepts Program", () => {
    const program = norm("VEST");
    const result = stringify(program);
    expect(result).toBe("VEST");
  });

  it("stringifyStatement works directly", () => {
    const program = norm("50 VEST FROM EVENT start");
    const result = stringifyStatement(program[0]);
    expect(result).toBe("50 VEST FROM EVENT start");
  });

  it("stringifyProgram works directly", () => {
    const program = norm("VEST");
    const result = stringifyProgram(program);
    expect(result).toBe("VEST");
  });
});

/* ------------------------
 * Round-trip Invariants
 * ------------------------ */

describe("round-trip invariants", () => {
  it("round-trip is idempotent", () => {
    const src = `
      VEST FROM LATER OF(
        EVENT x + 1 month,
        LATER OF(DATE 2025-01-01, DATE 2025-02-01)
      )
      OVER 12 months EVERY 1 month
    `;
    const first = roundTrip(src);
    const second = roundTrip(first);
    expect(second).toBe(first);
  });

  it("round-trip preserves semantics for complex schedule", () => {
    const src = `[
      1/4 VEST CLIFF 12 months,
      3/4 VEST
        FROM EVENT cliffEnd
        OVER 36 months EVERY 1 month
    ]`;
    const first = roundTrip(src);
    const second = roundTrip(first);
    expect(second).toBe(first);
  });
});
