import type { t } from "@vestlang/dsl";

const ZERO: t.TimeGate = { kind: "Zero" };
const GRANT: t.EventAtom = { kind: "Event", name: "grantDate" };

function isZero(d?: t.Duration): boolean {
  return !!d && d.value === 0;
}

export function toCNF(stmt: t.Statement): t.Statement {
  // inject one-shot schedule if none
  let schedule: t.Schedule = stmt.schedule ?? {
    from: GRANT,
    over: { kind: "Duration", value: 0, unit: "days" },
    every: { kind: "Duration", value: 0, unit: "days" },
    cliff: ZERO,
  };

  // defaults
  schedule.from ??= GRANT;
  schedule.cliff ??= ZERO;

  // guard: OVER 0 => EVERY 0
  if (isZero(schedule.over) && !isZero(schedule.every)) {
    schedule.every = { kind: "Duration", value: 0, unit: "days" };
  }

  // if multiple cliffs existed, they'd be combined before reaching here in a richer parser;
  // we assume single cliff, time-only, as per spec.

  // return full CNF
  return {
    amount: stmt.amount,
    schedule,
    if: stmt.if ?? undefined,
  };
}
