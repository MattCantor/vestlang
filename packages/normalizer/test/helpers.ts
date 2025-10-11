import { expect } from "vitest";
import {
  ASTExpr,
  ASTSchedule,
  ASTStatement,
  DateAnchor,
  EventAnchor,
  From,
  parse,
} from "@vestlang/dsl";

export const createDate = (s: string): DateAnchor => ({
  type: "DATE",
  value: s,
});
export const createEvent = (s: string): EventAnchor => ({
  type: "EVENT",
  value: s,
});

export function createSchedule(
  over: number,
  every: number,
  unit: "DAYS" | "MONTHS",
  from?: From,
  cliff?: any,
): ASTSchedule {
  return {
    type: "SINGLETON",
    from,
    over: { type: "DURATION", value: over, unit },
    every: { type: "DURATION", value: every, unit },
    cliff,
  };
}

export function createStatement(
  s: ASTSchedule,
  amount: any = { type: "AmountAbsolute", value: 100 },
): ASTStatement {
  return { amount, expr: s as unknown as ASTExpr };
}

export function parseOne(input: string): ASTStatement {
  const ast = parse(input);
  return ast as ASTStatement;
}

export function expectMonthsPeriodicity(
  expr: any,
  span: number,
  step: number,
  count: number,
) {
  expect(expr.type).toBe("SINGLETON");
  expect(expr.periodicity.periodType).toBe("MONTHS");
  expect(expr.periodicity.span).toBe(span);
  expect(expr.periodicity.step).toBe(step);
  expect(expr.periodicity.count).toBe(count);
  // placeholder retained for MONTHS
  expect(expr.periodicity.vesting_day_of_month).toBe(
    "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  );
}
