import { describe, it, expect } from "vitest";
import { evaluateGrantDate, evaluateCliff } from "../src/evaluate/cliff.js";
import { baseCtx } from "./helpers.js";

describe("evaluateGrantDate", () => {
  it("aggregates all installments strictly before grant date into cliff tranche", () => {
    const dates = [
      "2024-01-01" as OCTDate,
      "2024-02-01" as OCTDate,
      "2024-03-01" as OCTDate,
    ];
    const amounts = [1, 2, 3];
    const { newDates, newAmounts } = evaluateGrantDate(
      dates,
      amounts,
      "2024-02-01" as OCTDate,
    );
    expect(newDates).toEqual([
      "2024-02-01" as OCTDate,
      "2024-03-01" as OCTDate,
    ]);
    expect(newAmounts).toEqual([1 + 2, 3]);
  });
});

// A light integration around evaluateCliff through a resolved Picked<Schedule>
import type { PickedResolved } from "../src/evaluate/utils.js";
import { OCTDate } from "@vestlang/types";

function makePickedResolvedScheduleWithCliff(start: OCTDate, cliff: OCTDate) {
  return {
    type: "PICKED",
    picked: {
      periodicity: {
        type: "MONTHS",
        length: 1,
        occurrences: 3,
        cliff: {
          type: "SINGLETON",
          base: { type: "DATE", value: cliff },
          offsets: [],
        },
      },
    },
    meta: { type: "RESOLVED", date: start },
  } satisfies PickedResolved<any>;
}

describe("evaluateCliff integration", () => {
  it("resolved cliff collapses until cliff (RESOLVED tranches)", () => {
    const ctx = baseCtx();
    const picked = makePickedResolvedScheduleWithCliff(
      "2024-01-01" as OCTDate,
      "2024-02-01" as OCTDate,
    );
    const dates = [
      "2024-02-01" as OCTDate,
      "2024-03-01" as OCTDate,
      "2024-04-01" as OCTDate,
    ]; // generated post-start

    const amounts = [2, 3, 5];
    const out = evaluateCliff(picked as any, dates, amounts, ctx);
    expect(out.installments).toHaveLength(3);
    expect(out.installments[0]).toMatchObject({
      date: "2024-02-01" as OCTDate,
      amount: 2,
      meta: { state: "RESOLVED" },
    });
  });
});
