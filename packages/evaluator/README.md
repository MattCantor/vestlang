| file              | summary                     | details                                                         |
| :---------------- | :-------------------------- | :-------------------------------------------------------------- |
| index.ts          |                             |                                                                 |
| types.ts          | Evaluator-facing types      | ctx, Tranche, blockers, etc.                                    |
| time.ts           | Date helpers                | toDate/toISO, addDays, addMonthsRule, lt/gt/eq                  |
| conditions.ts     | BEFORE/AFTER evaluation     | (strict vs non-strict) w.r.t. a SUBJECT node                    |
| resolve.ts        | Node & NodeExpr resolution  | constraints, base, offsets, selectors for nodes                 |
| selectors.ts      | pickScheduleByStart()       | choose a schedule from a ScheduleExpr by vesting_start          |
| expandSchedule.ts | expandSchedule()            | turn ScheduleExpr → ExpandedSchedule (dates, start/cliff state) |
| allocation.ts     | amountToQuantify()          | replaces vestingMode.ts                                         |
| utils.ts          | createEvaluationContext()   | default vesting_day_of_month                                    |
| asof.ts           | evaluateStatementAsOf()     | use ExpandedSchedule to split vested vs unvested                |
| build.ts          | buildScheduleWithBlockers() | uses expandSchedule() + analyzeUnresolvedReasons()              |
| trace.ts          | analyzeUnresolvedReasons()  | enumerate blockers (missing events, unresolved selector, etc.)  |
