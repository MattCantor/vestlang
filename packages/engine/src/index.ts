import type { t } from "@vestlang/dsl";
import { toCNF } from "@vestlang/normalizer";
import {
  addDays,
  addMonths,
  addYears,
  addWeeks,
  max as maxDate,
  min as minDate,
} from "date-fns";

// --- helpers ---
function asDate(anchor: t.Anchor, ctx: Context): Date {
  if (anchor.kind === "Date") return new Date(anchor.iso + "T00:00:00Z");
  if (anchor.kind === "Event") {
    const when = ctx.events[anchor.name];
    if (!when) throw new Error(`Unresolved event: ${anchor.name}`);
    return when;
  }
  throw new Error("unknown anchor");
}
function addDuration(d: t.Duration, at: Date): Date {
  switch (d.unit) {
    case "days":
      return addDays(at, d.value);
    case "weeks":
      return addWeeks(at, d.value);
    case "months":
      return addMonths(at, d.value);
    case "years":
      return addYears(at, d.value);
  }
}

export interface Context {
  // event occurrences; e.g. { ChangeInControl: new Date("2027-02-01Z"), grantDate: new Date("2025-01-01Z") }
  events: Record<string, Date>;
}

export interface VestPoint {
  at: Date;
  vestedPercent: number; // cumulative vested percentage at 'at'
}

export function evaluate(statement: t.Statement, ctx: Context): VestPoint[] {
  const s = toCNF(statement);
  console.log("CNF schedule", JSON.stringify(s.schedule, null, 2));

  const from = asDate(s.schedule!.from!, ctx);
  const schedGate = scheduleGateTime(s.schedule!, from);
  const ifGate = ifGateTime(s.if ?? null, from, ctx);
  const gate = maxDate([schedGate, ifGate ?? from]);

  // build stepwise schedule (installments)
  const steps = buildInstallments(s.schedule!, from);
  const vested: VestPoint[] = [];

  let accrued = 0;
  for (const step of steps) {
    accrued += step.delta;
    const releaseTime = step.at < gate ? gate : step.at;
    const pct = Math.min(accrued, 1) * s.amount.value;
    vested.push({
      at: releaseTime,
      vestedPercent: pct,
    });
  }

  // compact by coalescing equal timestamps (optional)
  const map = new Map<number, number>();
  vested.forEach((p) => {
    const k = p.at.getTime();
    map.set(k, Math.max(map.get(k) ?? 0, p.vestedPercent));
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ at: new Date(t), vestedPercent: v }));
}

function scheduleGateTime(s: t.Schedule, from: Date): Date {
  if (!s.cliff || s.cliff.kind === "Zero") return from;
  if (s.cliff.kind === "Date") return new Date(s.cliff.iso + "T00:00:00Z");
  return addDuration(s.cliff, from);
}

function ifGateTime(
  cond: t.Condition | null,
  from: Date,
  ctx: Context,
): Date | null {
  if (!cond) return null;
  switch (cond.kind) {
    case "At":
      return new Date(cond.date.iso + "T00:00:00Z");
    case "After":
      return addDuration(cond.duration, from);
    case "EarlierOf": {
      const times = cond.items
        .map((c) => ifGateTime(c, from, ctx))
        .filter(Boolean) as Date[];
      if (times.length === 0) return null;
      return minDate(times);
    }
    case "LaterOf": {
      const times = cond.items
        .map((c) => ifGateTime(c, from, ctx))
        .filter(Boolean) as Date[];
      if (times.length === 0) return null;
      return maxDate(times);
    }
    default: {
      // EventAtom
      const e = cond as t.EventAtom;
      const when = ctx.events[e.name];
      if (!when) throw new Error(`Unresolved event: ${e.name}`);
      return when;
    }
  }
}

function buildInstallments(
  s: t.Schedule,
  from: Date,
): { at: Date; delta: number }[] {
  // stepwise accrual: N = D/P installments, each delta = 1/N (of the statement amount)
  if (s.over.value === 0) {
    return [{ at: from, delta: 1 }];
  }
  const n = countIntervals(s.over, s.every);
  const dates: Date[] = [];
  let cursor = from;
  for (let i = 1; i <= n; i++) {
    cursor = addDuration(s.every, cursor);
    dates.push(cursor);
  }
  const delta = 1 / n;
  return dates.map((d) => ({ at: d, delta }));
}

function countIntervals(over: t.Duration, every: t.Duration): number {
  // basic integer division (assume authoring matches exactly: e.g., 4 years / 1 month = 48)
  // you can add validation elsewhere to ensure divisibility.
  const toDays = (d: t.Duration) => {
    switch (d.unit) {
      case "days":
        return d.value;
      case "weeks":
        return d.value * 7;
      case "months":
        return d.value * 30; // simple approximation; validation should ensure exact multiples like 48 months
      case "years":
        return d.value * 365;
    }
  };
  const n = Math.round(toDays(over) / toDays(every));
  if (n <= 0) throw new Error("invalid schedule intervals");
  return n;
}
