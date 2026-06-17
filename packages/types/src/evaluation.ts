import type { VestingRuntime, VestingScheduleTemplate } from "./canonical.js";
import { VestingNode } from "./ast.js";
import { PeriodTag } from "./enums.js";
import { OCTDate, SelectorTag } from "./helpers.js";
import { VestingDayOfMonth } from "./oct_types.js";
import type { Finding } from "./diagnostic.js";

// The context every engine operation needs to resolve a schedule's structure:
// the grant anchor, fired events, share count, and the day-of-month rule. It
// carries no observation time — structure resolution is the same whether you
// ask "today" or "in a decade", so a `ResolutionContext` simply can't express
// one.
export interface ResolutionContext {
  /** The grant-date system anchor. A runtime input, not a fired milestone, so it
   *  is its own field (mirroring VestingRuntime) rather than an `events` entry. */
  grantDate: OCTDate;
  /** Genuine fired named events only (`ipo`, `milestone`) — no system anchors. */
  events: Record<string, OCTDate | undefined>;
  grantQuantity: number;
  vesting_day_of_month: VestingDayOfMonth;
  /** May this pass commit a contingent combinator (an EARLIER OF whose date arm
   *  has settled while an event arm is still pending) to its resolved floor?
   *
   *  Off by default. A firing-blind pass (the interchange verdict) and the
   *  wait-for-a-real-witness pass (rehydration) leave it off, so they keep
   *  externalizing the combinator as a synthetic event. The closed-world resolve
   *  paths turn it on: there an EARLIER OF's resolved arm is a *lower* bound on the
   *  start — any actual firing only moves the anchor earlier, so committing to it
   *  understates at worst and never over-vests.
   *
   *  Not on `ResolutionContextInput`: it's an internal pass-mode switch the live
   *  resolve entries set, not something a caller supplies. */
  commitContingent?: boolean;
}

// A point-in-time query adds the observation date on top of the structure
// context. `AsOfContext` IS-A `ResolutionContext` (the extra field only widens
// it), so an as-of entry can hand its context straight down to the structure
// evaluators that ignore `asOf` — that assignability is the point of the split.
export type AsOfContext = ResolutionContext & {
  asOf: OCTDate;
};

// Callers supply everything but the day-of-month rule (the evaluator defaults it).
export type ResolutionContextInput = Omit<
  ResolutionContext,
  "vesting_day_of_month"
> &
  Partial<Pick<ResolutionContext, "vesting_day_of_month">>;

export type AsOfContextInput = ResolutionContextInput & {
  asOf: OCTDate;
};

export type SymbolicDate =
  // `steps` is periods past the start, counted from 1: the first installment
  // reads START + 1 period, matching the resolved grid (gridDate's at(i + 1)).
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
      selector: SelectorTag;
      blockers: Blocker[];
    }
  | {
      type: "UNRESOLVED_CONDITION";
      node: VestingNode;
    };

export type ImpossibleBlocker =
  | {
      type: "IMPOSSIBLE_SELECTOR";
      selector: SelectorTag;
      blockers: ImpossibleBlocker[];
    }
  | {
      type: "IMPOSSIBLE_CONDITION";
      node: VestingNode;
    };

export type Blocker = UnresolvedBlocker | ImpossibleBlocker;

/* ------------------------
 * Per-space blocker brands
 * ------------------------ */

// The engine reports two verdicts, and an `IMPOSSIBLE_*` blocker reads differently
// in each. Firing-blind (interchange) it's a *static* contradiction — true no
// matter what fires. Closed-world (resolution) the same object reads as *dead given
// the firings we know*: the broader reading, since a static contradiction is dead
// under any firing too. These two brands tag which reading a blocker carries, so the
// type system keeps the spaces from leaking into each other. Same structure, distinct
// nominal identity; they're mutually exclusive, so neither arm is assignable to the
// other (a one-sided brand wouldn't stop interchange = resolution.dead, since a
// branded subtype stays assignable to the unbranded base — both sides must carry one).
//
// The internal pipeline stays on the plain `ImpossibleBlocker`; the brand is minted
// only at the two verdict boundaries, in blockerTree.ts. Nothing else casts to these.
export type DeadBlocker = ImpossibleBlocker & {
  readonly __space: "resolution";
};
export type StaticImpossibleBlocker = ImpossibleBlocker & {
  readonly __space: "interchange";
};

/* ------------------------
 * Node Meta
 * ------------------------ */

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

// `state` discriminates at the top level (not nested under a `meta` envelope) so
// TypeScript narrows `date`/`symbolicDate` straight off it — the "date present iff
// RESOLVED" invariant is the union's, not re-checked at each use site.

export interface ResolvedInstallment {
  state: "RESOLVED";
  amount: number;
  date: OCTDate;
}

export interface UnresolvedInstallment {
  state: "UNRESOLVED";
  amount: number;
  symbolicDate: SymbolicDate;
}

export interface ImpossibleInstallment {
  state: "IMPOSSIBLE";
  amount: number;
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
 * for. `definition` is `@vestlang/render` output — re-resolvable AND legible.
 * Populated when a combinator-over-anchors start mints a synthetic event;
 * `{}` otherwise.
 */
export interface SourceMapEntry {
  definition: string;
}

/** `event_id → { definition }`, keyed once per synthetic event. */
export type SourceMap = Record<string, SourceMapEntry>;

/* ------------------------
 * Evaluated Schedule
 * ------------------------ */

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
// Every arm carries the same two blocker lists, so a consumer never switches on
// `status` to read them: `pending` is what's still merely waiting on a witness,
// `dead` is what can never resolve given the firings we know (read as dead, not
// static — this is the closed-world space). Both are `[]` on arms that can't carry
// the relevant kind. The split is done once, in assemble.ts, off the flat blocker
// list the resolver leaves behind.
export type EvaluatedScheduleVerdict =
  | {
      status: "template";
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      sourceMap: SourceMap;
      // Mostly dated (compiled) tranches, but a pending EVENT-based statement
      // (unfired atomic event, or an unsettled synthetic combinator) keeps its
      // share claim here as symbolic UNRESOLVED installments — the same
      // mixed-stream rule as the events-only arm. All RESOLVED when every
      // statement has a known start.
      installments: (ResolvedInstallment | UnresolvedInstallment)[];
      // Pending witnesses (unfired atomic EVENT starts). A `template` can be
      // representable yet carry blockers + an empty/partial projection.
      pending: UnresolvedBlocker[];
      dead: DeadBlocker[];
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
      pending: UnresolvedBlocker[];
      dead: DeadBlocker[];
    }
  | {
      status: "unresolved";
      // Symbolic (UNRESOLVED/IMPOSSIBLE) installments, plus any RESOLVED tranches
      // from fully-resolved sibling statements in a mixed program.
      installments: Installment[];
      pending: UnresolvedBlocker[];
      dead: DeadBlocker[];
    }
  | {
      status: "impossible";
      installments: ImpossibleInstallment[];
      // A terminal program is all-dead, so `pending` is `[]` here.
      pending: UnresolvedBlocker[];
      dead: DeadBlocker[];
    };

/**
 * The resolution discriminant, read straight off the verdict arms so it can't
 * drift from them — spans both *resolvability* and *fidelity*:
 *   - "template"    — resolvable AND fits canonical's one-template shape (spec held).
 *   - "events-only" — resolvable to dated amounts but doesn't fit one template
 *                     (carries `reason`); facts preserved, intent lost.
 *   - "unresolved"  — pending: can't be materialized yet (e.g. unfired event).
 *   - "impossible"  — terminal/unsatisfiable: no witness assignment can resolve it.
 *
 * Named for the resolution (closed-world, firing-aware) verdict specifically;
 * the interchange verdict below keeps its own, distinct status vocabulary.
 */
export type ResolutionStatus = EvaluatedScheduleVerdict["status"];

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
      // The runtime that compiles this template (startDate, eventFirings,
      // grantDate, …). Firing-blind like the rest of the verdict, so it carries no
      // genuine event firings — only the synthetic/structural ones lowering minted.
      // Persist reads it to build the stored artifact off this verdict.
      runtime: VestingRuntime;
      sourceMap: SourceMap;
    }
  | {
      status: "events-only";
      // Same mixed stream as the resolution arm: a portion that floats on an
      // event reads as unfired here (firings are ignored), so its share claim
      // rides along symbolically rather than vanishing from the total.
      installments: Installment[];
      reason: NonTemplateReason;
      // No `blockers` here, deliberately — and that asymmetry with the
      // resolution events-only arm (which does carry them) is intentional.
      // A blocker like EVENT_NOT_YET_OCCURRED is a closed-world object: "not
      // yet occurred" only means something measured against known firings and
      // the as-of date, which is exactly the vocabulary a firing-invariant
      // verdict can't speak. The fact this verdict *can* state — "this portion
      // floats on event X, regardless of what's fired" — is already carried by
      // the symbolic installments above (state UNRESOLVED, with `symbolicDate`),
      // so a consumer reads pending-ness off `state !== "RESOLVED"`, not off a
      // blockers list. Widening this arm (adding
      // blockers, or a weaker "storable but provisional" status) is held back
      // until the open question of whether canonical should keep expressing
      // contingency at all is settled — that answer could force or forbid
      // reshaping this arm, so we don't pre-commit a shape now.
    }
  | { status: "unrepresentable"; reason: NonTemplateReason }
  // Firing-blind, so every blocker here is a *static* contradiction — branded as
  // such (in interchange.ts) to keep it distinct from a resolution-space `dead`.
  | { status: "impossible"; blockers: StaticImpossibleBlocker[] };

/**
 * One non-occurrence the current resolution is leaning on. Reading a schedule as,
 * say, "vested" often quietly assumes some event hasn't happened yet; this records
 * that assumption so it can be disclosed and watched.
 *
 * `through` is inclusive: the claim is "`eventId` did not occur on or before this
 * date."
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
  /**
   * When the schedule's cliff lump lands — read off the closed-world resolution.
   * For a duration cliff it's the statement's start plus the cliff length, using
   * the engine's own date arithmetic (so month-end clamping matches the dated
   * projection); for a fired event cliff it's the event's effective date. With
   * several cliffed statements it's the earliest such date.
   *
   * Null when there is no cliff, or no cliff can be placed yet — a pending start
   * anchor or an unfired event cliff. Independent of the as-of date.
   *
   * This is the cliff as written, before the grant-date fold a back-dated start
   * imposes on payment: a cliff that lands pre-grant still reports its raw date
   * here, because folding it onto the grant date is a payment overlay, not a
   * change to the schedule's cliff.
   */
  cliffDate: OCTDate | null;
}
