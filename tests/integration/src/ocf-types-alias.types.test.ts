// Locks in the tsconfig `paths` alias to the vendored OCF types. The guarantee
// is type-level: the final package specifier must resolve under the whole-repo
// typecheck, and each name must resolve to a concrete type rather than silently
// collapse to `any` if the alias ever breaks. `pnpm test` runs this green
// regardless (the imports are type-only); `pnpm typecheck` is what enforces it.
import { it, expectTypeOf } from "vitest";
import type {
  OCFScheduledVestingStatement,
  OCFMilestoneVestingStatement,
  OCFVestingTermsV2,
  OCFVestingScheduleSegment,
  OCFVestingScheduleCliff,
  OCFVestingDayOfMonthPolicy,
  OCFNumeric,
} from "@opencaptablecoalition/ocf-types";

// @ts-expect-error OCF inlines the scheduled|milestone statement union, so there
// is no standalone OCFVestingStatement export. If one reappears, this unused
// directive fails the build and the alias's surface needs a fresh look.
import type { OCFVestingStatement } from "@opencaptablecoalition/ocf-types";

it("resolves the OCF types alias and its expected export surface", () => {
  expectTypeOf<OCFScheduledVestingStatement>().not.toBeAny();
  expectTypeOf<OCFMilestoneVestingStatement>().not.toBeAny();
  expectTypeOf<OCFVestingTermsV2>().not.toBeAny();
  expectTypeOf<OCFVestingScheduleSegment>().not.toBeAny();
  expectTypeOf<OCFVestingScheduleCliff>().not.toBeAny();
  expectTypeOf<OCFVestingDayOfMonthPolicy>().not.toBeAny();
  expectTypeOf<OCFNumeric>().not.toBeAny();
  // Reference the absent-export import so it isn't flagged unused; the
  // suppressed import above is what actually asserts its non-existence.
  expectTypeOf<OCFVestingStatement>();
});
