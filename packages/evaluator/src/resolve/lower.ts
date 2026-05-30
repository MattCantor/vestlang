// Lower a resolved DSL program to a single canonical template.
//
// vestlang evaluates each statement independently, each with its own `FROM`
// start; the canonical template chains DATE statements off one hoisted
// `runtime.startDate` via a cursor. Lowering (1) reuses the selector layer to
// resolve each statement's start/cliff to concrete dates, (2) hoists the first
// DATE anchor to `runtime.startDate` and chains the rest, and (3) lowers the
// cliff to the time-based form. A program that resolves but doesn't fit one
// template (event cliff, non-chaining independent grids) or doesn't resolve is
// reported for the classifier (Phase 4b).

import type {
  Amount,
  Blocker,
  EvaluationContext,
  Program,
  Schedule,
  ScheduleExpr,
  VestingNodeExpr,
  OCTDate,
} from "@vestlang/types";
import type {
  Cliff,
  Fraction,
  PeriodType,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/core";
import { addPeriod, eq, fracReduce } from "@vestlang/core";
import { evaluateScheduleExpr } from "../evaluate/selectors.js";
import { isPickedResolved } from "../evaluate/utils.js";
import { lowerCliff, type LoweredCliff } from "./cliff.js";
import type { NonTemplateReason } from "./types.js";

const DEFAULT_DAY_OF_MONTH = "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";
const DEFAULT_ALLOCATION = "CUMULATIVE_ROUND_DOWN";

/** The two cumulative modes telescope as a single running fraction; the four
 *  loaded modes don't and so aren't template-compilable (→ events-only). */
export const isCumulativeAllocation = (mode: string): boolean =>
  mode === "CUMULATIVE_ROUND_DOWN" || mode === "CUMULATIVE_ROUNDING";

/** DSL amount → canonical portion. QUANTITY `v` → `v / totalShares`. */
export const amountToFraction = (a: Amount, totalShares: number): Fraction =>
  a.type === "QUANTITY"
    ? fracReduce({ numerator: a.value, denominator: totalShares })
    : fracReduce({ numerator: a.numerator, denominator: a.denominator });

/** First SINGLETON schedule of an expression (descend combinators' items[0]). */
const firstSchedule = (expr: ScheduleExpr): Schedule => {
  let e = expr;
  while (e.type !== "SINGLETON") e = e.items[0];
  return e;
};

/** DATE vs floating EVENT, from the (winning) schedule's vesting_start leaf. */
const startBase = (
  vs: VestingNodeExpr,
): { base: "DATE" | "EVENT"; eventId?: string } =>
  vs.type === "SINGLETON" && vs.base.type === "EVENT"
    ? { base: "EVENT", eventId: vs.base.value }
    : { base: "DATE" };

export interface StmtResolution {
  percentage: Fraction;
  periodicity: { type: PeriodType; length: number; occurrences: number };
  start:
    | { state: "RESOLVED"; date: OCTDate; base: "DATE" | "EVENT"; eventId?: string }
    | { state: "UNRESOLVED"; blockers: Blocker[] };
  cliff: LoweredCliff;
}

/** Resolve every statement against runtime — the shared input to 4a and 4b. */
export const resolveStatements = (
  program: Program,
  ctx: EvaluationContext,
  totalShares: number,
): StmtResolution[] =>
  program.map((stmt) => {
    const percentage = amountToFraction(stmt.amount, totalShares);
    const res = evaluateScheduleExpr(stmt.expr, ctx);

    if (isPickedResolved(res)) {
      const schedule = res.picked;
      const p = schedule.periodicity;
      const periodicity = {
        type: p.type,
        length: p.length,
        occurrences: p.occurrences,
      };
      return {
        percentage,
        periodicity,
        start: {
          state: "RESOLVED",
          date: res.meta.date,
          ...startBase(schedule.vesting_start),
        },
        cliff: lowerCliff(p.cliff, res.meta.date, p.type, p.length, p.occurrences, ctx),
      };
    }

    // Start did not fully resolve. Periodicity is best-effort for the
    // unresolved arm: the winning schedule if partially picked, else the first.
    const p =
      res.type === "PICKED" ? res.picked.periodicity : firstSchedule(stmt.expr).periodicity;
    const blockers: Blocker[] =
      res.type === "PICKED"
        ? res.meta.type === "UNRESOLVED"
          ? res.meta.blockers
          : []
        : res.blockers;
    return {
      percentage,
      periodicity: { type: p.type, length: p.length, occurrences: p.occurrences },
      start: { state: "UNRESOLVED", blockers },
      cliff: { state: "NONE" },
    };
  });

export type TemplateBuild =
  | {
      ok: true;
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      totalShares: number;
    }
  | {
      ok: false;
      why: "unresolved";
      resolutions: StmtResolution[];
      ctx: EvaluationContext;
      totalShares: number;
    }
  | {
      ok: false;
      why: "events";
      reason: NonTemplateReason;
      resolutions: StmtResolution[];
      ctx: EvaluationContext;
      totalShares: number;
    };

/**
 * Assemble one canonical template from the per-statement resolutions, or report
 * why it can't be one: any unresolved start/cliff → `unresolved`; an event cliff
 * or non-chaining independent DATE grids → `events`.
 */
export const buildTemplate = (
  resolutions: StmtResolution[],
  ctx: EvaluationContext,
  totalShares: number,
): TemplateBuild => {
  const unresolved = (): TemplateBuild => ({
    ok: false,
    why: "unresolved",
    resolutions,
    ctx,
    totalShares,
  });
  const events = (reason: NonTemplateReason): TemplateBuild => ({
    ok: false,
    why: "events",
    reason,
    resolutions,
    ctx,
    totalShares,
  });

  if (resolutions.some((r) => r.start.state !== "RESOLVED")) return unresolved();
  if (resolutions.some((r) => r.cliff.state === "UNRESOLVED")) return unresolved();
  // Loaded (non-cumulative) allocation isn't a single cumulative across the
  // template — the interchange has no allocation field. Route to events-only.
  if (!isCumulativeAllocation(ctx.allocation_type)) {
    return events({ kind: "LOADED_ALLOCATION", mode: ctx.allocation_type });
  }
  const eventCliff = resolutions.find((r) => r.cliff.state === "EVENT");
  if (eventCliff && eventCliff.cliff.state === "EVENT") {
    return events({ kind: "EVENT_CLIFF", eventId: eventCliff.cliff.eventId });
  }

  const dom = ctx.vesting_day_of_month;
  const statements: VestingStatement[] = [];
  const eventFirings: NonNullable<VestingRuntime["eventFirings"]> = [];
  // Core dates are plain ISO strings (OCFDate); addPeriod returns the same.
  let startDate: string | undefined;
  let cursor: string | undefined;

  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    if (r.start.state !== "RESOLVED") return unresolved(); // narrowing
    const { type, length, occurrences } = r.periodicity;

    let vesting_base: VestingStatement["vesting_base"];
    if (r.start.base === "EVENT") {
      vesting_base = { type: "EVENT", event_id: r.start.eventId! };
      eventFirings.push({ event_id: r.start.eventId!, date: r.start.date });
    } else {
      vesting_base = { type: "DATE" };
      if (cursor === undefined) {
        startDate = r.start.date;
      } else if (!eq(r.start.date, cursor)) {
        // A second independent DATE grid that doesn't chain — not one template.
        return events({ kind: "OVERLAPPING_ABSOLUTE_STARTS" });
      }
      cursor = addPeriod(r.start.date, occurrences * length, type, dom);
    }

    const cliff: Cliff | undefined =
      r.cliff.state === "RESOLVED" ? r.cliff.cliff : undefined;

    statements.push({
      order: i + 1,
      vesting_base,
      occurrences,
      period: length,
      period_type: type,
      percentage: r.percentage,
      ...(cliff ? { cliff } : {}),
    });
  }

  const runtime: VestingRuntime = {
    ...(startDate !== undefined ? { startDate } : {}),
    ...(eventFirings.length > 0 ? { eventFirings } : {}),
    // Grant-date implicit cliff: amounts scheduled before the grant existed fold
    // onto grantDate. Core's compile applies this when runtime.grantDate is set
    // (the legacy engine did it via evaluateGrantDate).
    ...(ctx.events.grantDate ? { grantDate: ctx.events.grantDate } : {}),
    ...(ctx.vesting_day_of_month !== DEFAULT_DAY_OF_MONTH
      ? { vestingDayOfMonth: ctx.vesting_day_of_month }
      : {}),
    ...(ctx.allocation_type !== DEFAULT_ALLOCATION
      ? { allocationType: ctx.allocation_type }
      : {}),
  };

  return {
    ok: true,
    template: { id: "resolved", statements },
    runtime,
    totalShares,
  };
};
