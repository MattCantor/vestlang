import { describe, it, expect } from "vitest";
import { evaluateStatement } from "../src/evaluate/build.js";
import {
  baseCtx,
  makeVestingBaseDate,
  makeSingletonSchedule,
} from "./helpers.js";
import {
  OCTDate,
  Statement,
  TwoOrMore,
  VestingNodeExpr,
} from "@vestlang/types";

describe("evaluateStatement - end to end", () => {
  it("IMPOSSIBLE schedule yields single IMPOSSIBLE tranche", () => {
    const stmt: Statement = {
      amount: {
        type: "QUANTITY",
        value: 100,
      },
      expr: {
        type: "EARLIER_OF",
        items: [
          {
            type: "SINGLETON",
            vesting_start: {
              type: "EARLIER_OF",
              items: [] as unknown as TwoOrMore<VestingNodeExpr>,
            },
            periodicity: { type: "MONTHS", length: 1, occurrences: 1 },
          },
          {
            type: "SINGLETON",
            vesting_start: {
              type: "EARLIER_OF",
              items: [] as unknown as TwoOrMore<VestingNodeExpr>,
            },
            periodicity: { type: "MONTHS", length: 1, occurrences: 1 },
          },
        ],
      },
    };

    const ctx_input = { ...baseCtx() };
    const out = evaluateStatement(stmt, ctx_input);
    expect(out).toHaveLength(1);
    expect(out[0].meta.state).toBe("IMPOSSIBLE");
  });

  it("UNRESOLVED vesting_start → BEFORE_VESTING_START tranche", () => {
    const stmt = {
      amount: {
        type: "QUANTITY",
        value: 30,
      },
      expr: makeSingletonSchedule(
        {
          type: "SINGLETON",
          base: { type: "EVENT", value: "notThereYet" },
          offsets: [],
        } as any,
        { type: "MONTHS", length: 1, occurrences: 3 },
      ),
    } as any;
    const ctx_input = {
      ...baseCtx({ events: { grantDate: "2025-01-01" as OCTDate } }),
    };
    const out = evaluateStatement(stmt, ctx_input);
    expect(out).toHaveLength(1);
    expect((out[0] as any).meta.date.type).toBe("BEFORE_VESTING_START");
  });

  it("Resolved path generates tranches, applies grant-date catch-up, then cliff", () => {
    const stmt = {
      amount: {
        type: "QUANTITY",
        value: 10,
      },
      expr: makeSingletonSchedule(
        {
          type: "SINGLETON",
          base: makeVestingBaseDate("2024-01-01" as OCTDate),
          offsets: [],
        } as any,
        {
          type: "MONTHS",
          length: 1,
          occurrences: 3,
          cliff: {
            type: "SINGLETON",
            base: makeVestingBaseDate("2024-02-01" as OCTDate),
            offsets: [],
          },
        },
      ),
    } as any;
    const ctx_input = baseCtx({
      events: {
        grantDate: "2024-01-15" as OCTDate,
      },
      allocation_type: "CUMULATIVE_ROUND_DOWN",
    });
    const out = evaluateStatement(stmt, ctx_input);
    // 3 tranches total, with catch-up at 2024-01-15 collapsed into first vest after start (which is 2024-02-01)
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({ meta: { state: "RESOLVED" } });
  });
});
