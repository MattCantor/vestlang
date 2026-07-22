---
"@vestlang/vestlang": patch
"@vestlang/mcp-server": patch
---

`vestlang_lint`, `vestlang_evaluate`, and `vestlang_persist` now reject a gate that
pins both sides of a BEFORE/AFTER comparison to the same non-date anchor and can never
be satisfied whenever the event fires — for example `FROM EVENT ipo STRICTLY AFTER
EVENT ipo`, or `FROM EVENT s AFTER EVENT b AND STRICTLY BEFORE EVENT b`. Previously such
a schedule linted clean and stored as a template even though it resolves to impossible
the instant the referenced event fires. Lint raises a new `unsatisfiable-event-gate`
error, evaluate reports the schedule as impossible / not representable, and persist
refuses it. The check is firing-invariant and deliberately conservative: when an offset
delta can't be ordered without committing to month lengths (a mixed-sign month+day
offset), it abstains, so genuinely satisfiable gates are never flagged. Fixed-date gates
continue to route through the existing `unsatisfiable-date-window` rule, unchanged.
