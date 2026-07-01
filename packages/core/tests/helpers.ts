import type { OCFVestingStatement, OCFVestingTermsV2 } from "@vestlang/types";

// A canonical interchange template carrying the required OCF `VESTING_TERMS` tag.
// The annotated return type pins `object_type` to the literal, so a positive
// construction can't silently drop it.
export const mkTemplate = (
  id: string,
  statements: OCFVestingStatement[],
): OCFVestingTermsV2 => ({ object_type: "VESTING_TERMS", id, statements });

// One scheduled statement: a single 12-month lump at the given share-of-grant,
// with a distinct order so a multi-statement template stays structurally valid.
const statement = (order: number, percentage: string) => ({
  order,
  schedule: {
    occurrences: 1,
    period: 12,
    period_type: "MONTHS" as const,
  },
  percentage,
});

// A template of such statements, one per percentage (orders 1..n). Percentages
// are share-of-grant, so values summing past 1 make an over-allocating fixture.
export const template = (...percentages: string[]) =>
  mkTemplate(
    "alloc",
    percentages.map((p, i) => statement(i + 1, p)),
  );
