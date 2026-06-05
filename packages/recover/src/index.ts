// @vestlang/recover
//
// Recovers a single canonical template from an `events-only` program whose
// realized projection actually has one — the second-opinion pass that sits
// above the evaluator and the inferrer (it needs both, plus the evaluator
// again to re-classify, so it can't live in either without a dependency cycle).
//
// This is the scaffold only; the recovery entry point lands next. For now the
// barrel just surfaces the three things a recovered schedule is made of, so the
// package already has a real public shape — and so the empty leaf has a genuine
// use for its one dependency instead of declaring an unused one.

export type {
  VestingScheduleTemplate,
  VestingRuntime,
  VestingDayOfMonth,
} from "@vestlang/types";
