import type { VestingRuntime, VestingScheduleTemplate } from "./canonical.js";
import { VestingNode } from "./ast.js";
import { PeriodTag } from "./enums.js";
import { OCTDate } from "./helpers.js";
import { VestingDayOfMonth } from "./oct_types.js";
import type { Finding } from "./diagnostic.js";

export interface EvaluationContext {
  /** The grant-date system anchor. A runtime input, not a fired milestone, so it
   *  is its own field (mirroring VestingRuntime) rather than an `events` entry. */
  grantDate: OCTDate;
  /** The vesting-start system anchor a cliff hangs off. Overlaid per-statement
   *  during cliff/unresolved resolution; absent on the base context. */
  vestingStart?: OCTDate;
  /** Genuine fired named events only (`ipo`, `milestone`) — no system anchors. */
  events: Record<string, OCTDate | undefined>;
  grantQuantity: number;
  asOf: OCTDate;
  vesting_day_of_month: VestingDayOfMonth;
}

// Callers supply everything but the day-of-month rule (the evaluator defaults it)
// and the transient `vestingStart` overlay (set internally during resolution).
export type EvaluationContextInput = Omit<
  EvaluationContext,
  "vesting_day_of_month" | "vestingStart"
> &
  Partial<Pick<EvaluationContext, "vesting_day_of_month">>;

export type SymbolicDate =
  | { type: "START_PLUS"; unit: PeriodTag; steps: number }
  | { type: "UNRESOLVED_VESTING_START" }
  | { type: "UNRESOLVED_CLIFF"; date: OCTDate };

/* ------------------------
 * Blockers
 * ------------------------ */

export type UnresolvedBlocker =
  | {
      type: "EVENT_NOT_YET_OCCURRED";
      event: string;
      // Set when this pending event was checked against a known date — a gate's
      // "before/after <date>" or the date a LATER OF already settled on. It's the
      // latest date we're taking the event to still be absent on/before; that's
      // what feeds the schedule's absence-assumption disclosure. Left off when the
      // event is simply awaited with nothing to compare it to (a bare FROM EVENT).
      through?: OCTDate;
    }
  | {
      type: "UNRESOLVED_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: Blocker[];
    }
  | {
      type: "UNRESOLVED_CONDITION";
      node: VestingNode;
    };

export type ImpossibleBlocker =
  | {
      type: "IMPOSSIBLE_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: ImpossibleBlocker[];
    }
  | {
      type: "IMPOSSIBLE_CONDITION";
      node: VestingNode;
    };

export type Blocker = UnresolvedBlocker | ImpossibleBlocker;

/* ------------------------
 * Node Meta
 * ------------------------ */

export type NodeResolutionState = "IMPOSSIBLE" | "UNRESOLVED" | "RESOLVED";

export type ResolvedNode = {
  type: "RESOLVED";
  date: OCTDate;
};

export type UnresolvedNode = {
  type: "UNRESOLVED";
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[];
};

export type ImpossibleNode = {
  type: "IMPOSSIBLE";
  blockers: ImpossibleBlocker[];
};

export type NodeMeta = ResolvedNode | UnresolvedNode | ImpossibleNode;

/* ------------------------
 * Installments
 * ------------------------ */

export interface InstallmentMeta {
  index?: number;
  state: NodeResolutionState;
  symbolicDate?: SymbolicDate;
  unresolved?: string;
}

export interface BaseInstallment {
  amount: number;
  date?: OCTDate;
  meta: InstallmentMeta;
}

export interface ImpossibleInstallment extends BaseInstallment {
  amount: number;
  date?: never;
  meta: {
    state: "IMPOSSIBLE";
    symbolicDate?: never;
    unresolved: string;
  };
}

export interface UnresolvedInstallment extends BaseInstallment {
  date?: never;
  meta: {
    state: "UNRESOLVED";
    symbolicDate: SymbolicDate;
    unresolved: string;
  };
}

export interface ResolvedInstallment extends BaseInstallment {
  date: OCTDate;
  meta: {
    state: "RESOLVED";
    symbolicDate?: never;
    unresolved?: never;
  };
}

export type Installment =
  | ImpossibleInstallment
  | UnresolvedInstallment
  | ResolvedInstallment;

/** Amount-carrying installments with symbolic/absent dates (the unresolved arm). */
export type SymbolicInstallment = UnresolvedInstallment | ImpossibleInstallment;

/* ------------------------
 * Source map
 * ------------------------ */

/**
 * One externalized gate definition: the DSL the synthetic `event_id` stands in
 * for, plus an optional display name. `definition` is `@vestlang/render`
 * output — re-resolvable AND legible. Populated when a combinator-over-anchors
 * start mints a synthetic event; `{}` otherwise.
 */
export interface SourceMapEntry {
  definition: string;
  label?: string;
}

/** `event_id → { definition, label? }`, keyed once per synthetic event. */
export type SourceMap = Record<string, SourceMapEntry>;

/* ------------------------
 * Evaluated Schedule
 * ------------------------ */

/**
 * The verdict discriminant — spans both *resolvability* and *fidelity*:
 *   - "template"    — resolvable AND fits canonical's one-template shape (spec held).
 *   - "events-only" — resolvable to dated amounts but doesn't fit one template
 *                     (carries `reason`); facts preserved, intent lost.
 *   - "unresolved"  — pending: can't be materialized yet (e.g. unfired event).
 *   - "impossible"  — terminal/unsatisfiable: no witness assignment can resolve it.
 */
export type Status = "template" | "events-only" | "unresolved" | "impossible";

/**
 * A bare bag of installments + blockers, with no verdict. The internal
 * installment-builder helpers (makeTranches/unresolved) produce these; the
 * public evaluate path then wraps them into a tagged `EvaluatedSchedule` arm.
 * Keeping this distinct is what lets `EvaluatedSchedule.status` stay required.
 */
export interface InstallmentSet {
  installments: Installment[];
  blockers: Blocker[];
}

/**
 * The verdict half of the published contract: a discriminated union keyed on
 * `status` (always present), where the presence of the canonical artifact is
 * implied by the arm.
 */
export type EvaluatedScheduleVerdict =
  | {
      status: "template";
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      sourceMap: SourceMap;
      installments: ResolvedInstallment[];
      blockers: Blocker[];
    }
  | {
      status: "events-only";
      // Mostly dated (RESOLVED) tranches — that's what earned the arm — but a
      // sibling portion still waiting on an event keeps its shares here as
      // symbolic (UNRESOLVED) installments, the same mixed-stream rule as the
      // unresolved arm.
      installments: Installment[];
      // Structured, like the interchange verdict's — the same fact lands a
      // schedule off a single template in both. Rendered to prose only at the
      // view boundary, so a consumer can still gate on the kind.
      reason: NonTemplateReason;
      // The pending portions' missing witnesses. Empty when everything dated.
      blockers: Blocker[];
    }
  | {
      status: "unresolved";
      // Symbolic (UNRESOLVED/IMPOSSIBLE) installments, plus any RESOLVED tranches
      // from fully-resolved sibling statements in a mixed program.
      installments: Installment[];
      blockers: Blocker[];
    }
  | {
      status: "impossible";
      installments: ImpossibleInstallment[];
      blockers: ImpossibleBlocker[];
    };

/* ------------------------
 * Interchange verdict
 * ------------------------ */

/**
 * Why a schedule can't be expressed as a single canonical template. Shared by both
 * verdicts below, since the same structural fact can land a schedule in different
 * buckets depending on which question you're asking.
 */
export type NonTemplateReason =
  // Two (or more) independent absolute-date grids on one grant. A record keeper
  // models those as separate grants, so they can't collapse into one template.
  | { kind: "OVERLAPPING_ABSOLUTE_STARTS"; detail?: string }
  // The cliff hangs off a named event. The canonical cliff is a fixed duration, so
  // it has nowhere to put an event-anchored cliff.
  | { kind: "EVENT_CLIFF"; eventId: string; detail?: string }
  // A THEN tail chained behind a head that's waiting on an event: the tail can't
  // be dated until the head's event fires, and there's no cliff involved at all.
  // `eventId` is what the head waits on: the event's name for a bare
  // `FROM EVENT x`, or the anchor's DSL definition when the head is a
  // combinator/gated/offset expression.
  | { kind: "EVENT_CHAINED_TAIL"; eventId: string; detail?: string }
  // The cliff can only be placed once we know when an event fired, so we can't
  // pin it down ahead of time and there's nothing storable to hand over.
  | { kind: "DEFERRED_CLIFF"; detail?: string };

/**
 * What a record keeper could store for this schedule, asked WITHOUT looking at
 * which events have actually fired. This is the stable floor: because it ignores
 * firings, a new event arriving can never change the answer, so it's safe to
 * persist. (Contrast `EvaluatedScheduleVerdict` below, which answers the
 * here-and-now question and does consult fired events.)
 *
 *   - "template"         stores as one canonical template (an event-anchored start
 *                        is fine — it rides across as a deferred/synthetic event).
 *   - "events-only"      stores as a flat list of dated vesting events, but not one
 *                        template (e.g. two independent date grids).
 *   - "unrepresentable"  the record keeper has no home for it at all, even as bare
 *                        events. Three causes today: an event-anchored cliff
 *                        (EVENT_CLIFF), a cliff that can't be placed until a firing
 *                        is known (DEFERRED_CLIFF), and a THEN tail behind a head
 *                        still waiting on an event (EVENT_CHAINED_TAIL) — no cliff,
 *                        just a sequence that can't be dated yet.
 *   - "impossible"       self-contradictory no matter what events fire (e.g. a date
 *                        required to fall after a strictly later date).
 */
export type InterchangeVerdict =
  | {
      status: "template";
      template: VestingScheduleTemplate;
      sourceMap: SourceMap;
    }
  | {
      status: "events-only";
      // Same mixed stream as the resolution arm: a portion that floats on an
      // event reads as unfired here (firings are ignored), so its share claim
      // rides along symbolically rather than vanishing from the total.
      installments: Installment[];
      reason: NonTemplateReason;
    }
  | { status: "unrepresentable"; reason: NonTemplateReason }
  | { status: "impossible"; blockers: ImpossibleBlocker[] };

/**
 * One non-occurrence the current resolution is leaning on. Reading a schedule as,
 * say, "vested" often quietly assumes some event hasn't happened yet; this records
 * that assumption so it can be disclosed and watched.
 *
 * `through` is inclusive: the claim is "`eventId` did not occur on or before this
 * date." (Populated in a later phase; emitted as an empty list for now.)
 */
export interface AbsenceAssumption {
  eventId: string;
  through: OCTDate;
}

/**
 * The published evaluation result. It carries two verdicts side by side, because
 * "what can be stored for this schedule" and "what does it work out to given the
 * events we currently know" are genuinely different questions:
 *
 *   - `interchange` is firing-invariant — the storable floor (see InterchangeVerdict).
 *   - `resolution` is the closed-world, here-and-now answer that does read events.
 *
 * `absenceAssumptions` lists the non-occurrences `resolution` leaned on. `findings`
 * (over/under-allocation, etc.) sits at the top level because it's about the
 * schedule as written, independent of either verdict — a perfectly storable
 * `template` can still allocate more than 100% of the grant.
 */
export interface EvaluatedSchedule {
  interchange: InterchangeVerdict;
  resolution: EvaluatedScheduleVerdict;
  absenceAssumptions: AbsenceAssumption[];
  findings: Finding[];
}
