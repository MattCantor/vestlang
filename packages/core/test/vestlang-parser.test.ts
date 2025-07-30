import { describe, it, expect } from "vitest";
import { parseVestingDSL } from '../src';

describe("Vestlang Parser - Core DSL", () => {
  it("parses immediate vesting", () => {
    const input = "vest 100";
    const result = parseVestingDSL(input);
    console.log(result);
    expect(result).toEqual(
      {
        type: "vest",
        amount: 100,
        condition: null,
        schedule: null,
      },
    );
  });

  it("parses contingent vesting on a single event", () => {
    const input = `vest 100 if IPO`;
    const result = parseVestingDSL(input);
    console.log(result);
    expect(result).toEqual({
    type: "vest",
    amount: 100,
    condition: { type: "condition", event: "IPO" },
    schedule: null
  });
  });

  
  it("parses vesting over time with a simple schedule", () => {
  const input = `vest 100 over 48 months every 1 month`;

  const result = parseVestingDSL(input.trim());
  console.log(result);
  expect(result).toEqual({
    type: "vest",
    amount: 100,
    condition: null,
    schedule: {
      type: "schedule",
      duration: { amount: 48, unit: "months" },
      cadence: { amount: 1, unit: "months" },
      start: { type: "vcd", value: "grant_date" }
    }
  });
});

  it("parses installment vesting starting at a specific event", () => {
    const input = 'vest 100 over 48 months every 1 month starting IPO';
    const result = parseVestingDSL(input);
    console.log(result);
    expect(result).toEqual({
      type: "vest",
      amount: 100,
      condition: null,
      schedule: {
        type: "schedule",
        duration: { amount: 48, unit: "months" },
        cadence: { amount: 1, unit: "months" },
        start: { type: "vcd", value: "IPO" }
      }
    });
  })

  it("parses installment vesting with a specific start date", () => {
    const input = 'vest 100 over 48 months every 1 month starting 2023-01-01';
    const result = parseVestingDSL(input);
    console.log(result);
    expect(result).toEqual({
      type: "vest",
      amount: 100,
      condition: null,
      schedule: {
        type: "schedule",
        duration: { amount: 48, unit: "months" },
        cadence: { amount: 1, unit: "months" },
        start: { type: "vcd", value: "2023-01-01" }
      }
    });
  });

  });
