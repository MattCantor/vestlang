import type { OCFVestingStatement, OCFVestingTermsV2 } from "@vestlang/types";

// A canonical interchange template carrying the required OCF `VESTING_TERMS` tag.
// The annotated return type pins `object_type` to the literal, so a positive
// construction can't silently drop it.
export const mkTemplate = (
  id: string,
  statements: OCFVestingStatement[],
): OCFVestingTermsV2 => ({ object_type: "VESTING_TERMS", id, statements });
