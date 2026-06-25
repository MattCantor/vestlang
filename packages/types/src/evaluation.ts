import type {
  StoredTerms,
  VestingRuntime,
  VestingScheduleTemplate,
} from "./canonical.js";
import { VestingNode } from "./ast.js";
import { PeriodTag } from "./enums.js";
import { OCTDate, SelectorTag } from "./helpers.js";
import { VestingDayOfMonth } from "./oct_types.js";
import type { Finding } from "./diagnostic.js";

// Which engine configuration a resolution is running under. Three legitimate
// configs that a boolean can't tell apart:
//   - "resolution"  — the closed-world, here-and-now reading. Reads real firings
//                     AND lets an EARLIER_OF commit to its resolved floor (its
//                     resolved arm is a lower bound, so committing to it is the
//                     latest-possible anchor — a guaranteed vesting floor).
//   - "interchange" — the firing-invariant storable floor. Reads every named
//                     event as "not fired" and never commits.
//   - "rehydrate"   — reload from a stored artifact. Reads the world's attested
//                     firings, but must NOT commit: committing would resolve a
//                     stored gate to its date floor on every reload, fabricating
//                     a firing the world never produced.
// `rehydrate` is why a boolean is insufficient — it shares "reads firings" with
// `resolution` but "does not commit" with `interchange`.
export type EvaluationMode = "resolution" | "interchange" | "rehydrate";

// Fields every engine operation needs to resolve a schedule's structure,
// independent of which mode it runs under: the grant anchor, share count, and the
// day-of-month rule. The firing map (`events`) is *not* here — whether the built
// context carries one is exactly what `mode` discriminates (below). No observation
// time either: structure resolution is the same whether you ask "today" or "in a
// decade", so a `ResolutionContext` simply can't express one.
interface ResolutionContextBase {
  /** The grant-date system anchor. A runtime input, not a fired milestone, so it
   *  is its own field (mirroring VestingRuntime) rather than an `events` entry. */
  grantDate: OCTDate;
  grantQuantity: number;
  vesting_day_of_month: VestingDayOfMonth;
}

// The built context, discriminated on `mode` so firing-invariance is carried by
// the type rather than by a runtime convention. The `interchange` arm omits
// `events` outright — a firing read on it is a compile error (#320), not a
// disciplined `mode === "interchange"` check the next read site might forget.
// `resolution` and `rehydrate` both read real firings, so they carry the map.
//
// `mode` is stamped by each entry point, never by a caller — that's why `*Input`
// drops it (and why the input type is defined independently below, not Omitted off
// this union). It governs both the firing read (firing-blind in `interchange`) and
// whether a partial EARLIER_OF commits (only in `resolution`); see EvaluationMode.
export type ResolutionContext =
  | (ResolutionContextBase & {
      mode: "interchange";
    })
  | (ResolutionContextBase & {
      mode: "resolution" | "rehydrate";
      /** Genuine fired named events only (`ipo`, `milestone`) — no system anchors. */
      events: Record<string, OCTDate | undefined>;
    });

// A point-in-time query adds the observation date on top of the structure
// context. As-of only ever runs in `resolution` mode (asof.ts), so it's pinned to
// the events-bearing arm — NOT `ResolutionContext & { asOf }`, which would
// distribute over the union and re-introduce an `interchange + asOf` arm. The
// firings-bearing arm is still a `ResolutionContext`, so an as-of entry can hand
// its context straight down to the structure evaluators that ignore `asOf`.
export type AsOfContext = Extract<
  ResolutionContext,
  { mode: "resolution" | "rehydrate" }
> & {
  asOf: OCTDate;
};

// Callers supply everything but the day-of-month rule (the evaluator defaults it)
// and the `mode` (each entry point stamps its own — a caller can't override which
// engine config a resolution runs under). Defined independently of the built
// `ResolutionContext` DU rather than derived from it: the input is uniform — it
// always carries `events` regardless of which mode will later be stamped — so it
// can't be the `mode`-less projection of a union whose arms disagree on `events`.
export interface ResolutionContextInput {
  grantDate: OCTDate;
  events: Record<string, OCTDate | undefined>;
  grantQuantity: number;
  vesting_day_of_month?: VestingDayOfMonth;
}

export type AsOfContextInput = ResolutionContextInput & {
  asOf: OCTDate;
};

export type SymbolicDate =
  // `steps` is periods past the start, counted from 1: the first installment
  // reads START + 1 period, matching the resolved grid (gridDate's at(i + 1)).
  | { type: "START_PLUS"; unit: PeriodTag; steps: number }
  | { type: "UNRESOLVED_VESTING_START" }
  // `date` keeps its honest grid (cadence) position — the tranche's spot in the
  // accrual breakdown, NOT a claim it can vest then. `floor` (optional) is the
  // earliest it could actually land: the resolved time-arm `cliffDate` of a
  // `LATER OF` cliff (nothing releases before that lower bound). Absent when the
  // cliff is a bare `CLIFF EVENT e` with no time arm — there's no known floor to
  // disclose, so the key is omitted rather than defaulted.
  | { type: "UNRESOLVED_CLIFF"; date: OCTDate; floor?: OCTDate };

/* ------------------------
 * Blockers
 * ------------------------ */

// The relation an absence disclosure guards against, separate from the boundary
// date itself (`through`). A watch-list entry isn't just "event X stayed absent
// through date D" — the dangerous firing of X lands on one *side* of D, and that
// side is what a consumer must re-check:
//   - `direction` — which way a firing has to fall to move the result. `before`:
//     a firing on/before the boundary is the dangerous one (a `BEFORE` gate, or an
//     EARLIER OF whose pending arm could land earlier). `after`: a firing on/after
//     is dangerous (an `AFTER` gate, or a LATER OF whose pending arm could land
//     later and shift the grid).
//   - `inclusive` — whether the boundary day itself is dangerous. For a gate this
//     is the complement of "did the gate admit the boundary day": a non-strict gate
//     admits it (benign, exclusive), a strict gate excludes it (dangerous,
//     inclusive). The two selectors compare strictly, so their boundary day is
//     always benign (exclusive).
//   - `consequence` — what the dangerous firing actually does, which isn't derivable
//     from `direction`. A gate (`BEFORE`/`AFTER EVENT`) and a selector (EARLIER/LATER
//     OF) can guard the same side of the same boundary yet differ here: a gate firing
//     on the dangerous side makes the gate unsatisfiable, so the grant
//     `flips-to-impossible`; a selector firing only moves the start, so it's a
//     `grid-shift` — still a valid schedule, just re-anchored.
export interface AbsenceDescriptor {
  direction: "before" | "after";
  inclusive: boolean;
  consequence: "grid-shift" | "flips-to-impossible";
}

export type UnresolvedBlocker =
  | ({
      type: "EVENT_NOT_YET_OCCURRED";
      event: string;
      // Set when this pending event was checked against a known date — a gate's
      // boundary or the date a LATER OF already settled on. It's the boundary the
      // schedule's absence-assumption disclosure reports the event stayed absent
      // against. Left off when the event is simply awaited with nothing to compare
      // it to (a bare FROM EVENT) — then the descriptor fields below are absent too.
      through?: OCTDate;
    } & Partial<AbsenceDescriptor>)
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

// An EARLIER_OF that committed to its resolved floor in `resolution` mode: it has
// a date (the earliest resolved arm) AND carries the still-pending siblings'
// blockers, stamped `through` the committed date. Distinct from RESOLVED so the
// disclosures can't be dropped — a date-read site that only handles RESOLVED has
// to be taught COMMITTED too (a build break, not a silent miss). The mirror of a
// partial LATER_OF, except this one settles to a date instead of staying pending:
// an EARLIER_OF's resolved arm is a *lower* bound, so committing to it never
// over-vests, whereas LATER_OF's is an *upper* bound and must stay open.
export type CommittedNode = {
  type: "COMMITTED";
  date: OCTDate;
  // Required: the committed pick exists precisely to carry these. Each is a
  // still-pending sibling's blocker, already stamped `through` the committed date,
  // so it flows to `absenceAssumptions` and `resolution.pending`.
  disclosures: Blocker[];
};

export type NodeMeta =
  | ResolvedNode
  | UnresolvedNode
  | ImpossibleNode
  | CommittedNode;

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
 * One externalized start recipe: the DSL a reserved sidecar key stands in for.
 * `definition` is `@vestlang/render` output — re-resolvable AND legible. A
 * contingent start (its date unknown until a named event fires) externalizes its
 * recipe under the single reserved `evt:start` key; `{}` for a plain dated
 * schedule. Rehydration re-resolves the recipe to recover the real start.
 */
export interface SourceMapEntry {
  definition: string;
}

/** `event_id → { definition }`. Carries at most the one reserved `evt:start`
 *  entry for a contingent start. */
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
      // Mostly dated (compiled) tranches, but a contingent start whose event
      // hasn't fired keeps its share claim here as symbolic UNRESOLVED
      // installments — the same mixed-stream rule as the events-only arm. All
      // RESOLVED when the start is known.
      installments: (ResolvedInstallment | UnresolvedInstallment)[];
      // Pending witnesses (a contingent start awaiting its event). A `template`
      // can be representable yet carry blockers + an empty/partial projection.
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
  // More than one distinct contingent START origin on one grant — two named
  // events anchoring different portions, or a contingent event start beside a
  // fixed dated start. canonical hoists exactly one `runtime.startDate` (and one
  // reserved `evt:start` recipe), so it has nowhere to hold a second origin.
  // Distinct from OVERLAPPING_ABSOLUTE_STARTS, which is two *resolved* date grids;
  // this is two starts at least one of which is event-contingent. The grant stays
  // DSL-expressible — a record keeper would model the origins as separate grants.
  | { kind: "MULTIPLE_START_ORIGINS"; detail?: string }
  // A THEN tail chained behind a head that's waiting on an event: the tail can't
  // be dated until the head's event fires, and there's no cliff involved at all.
  // `eventId` is what the head waits on: the event's name for a bare
  // `FROM EVENT x`, or the anchor's DSL definition when the head is a
  // combinator/gated/offset expression.
  | { kind: "EVENT_CHAINED_TAIL"; eventId: string; detail?: string }
  // A statically-impossible component (a start that contradicts itself — e.g. a
  // date required to fall strictly before its own date — independent of any
  // firing) coexists on the grant with a live, still-pending portion. The
  // impossible component on its own would roll the schedule up to `impossible`;
  // the live portion keeps it off that all-void rollup, so the impossibility
  // surfaces here as the *reason* the grant can't be stored as one template —
  // the hardest constraint leads, ahead of any pending-chain or cliff cause.
  // `eventId`, when present, is the event the coexisting live chain's head is
  // waiting on (carried so the pending part isn't lost from the reason); omitted
  // when no single event names it.
  | { kind: "IMPOSSIBLE_COMPONENT"; eventId?: string; detail?: string }
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
 *   - "template"         stores as one canonical template. A single contingent
 *                        start (its date unknown until an event fires) is fine —
 *                        it stores as a DATE base on the sentinel startDate plus a
 *                        reserved `evt:start` recipe.
 *   - "events-only"      stores as a flat list of dated vesting events, but not one
 *                        template (e.g. two independent date grids, or more than
 *                        one distinct start origin — MULTIPLE_START_ORIGINS).
 *   - "unrepresentable"  the record keeper has no home for it at all, even as bare
 *                        events. Three causes today: a statically-impossible
 *                        component coexisting with a live pending portion
 *                        (IMPOSSIBLE_COMPONENT — the impossibility leads, since it
 *                        can never be stored regardless of firings), a cliff that
 *                        can't be placed until a firing is known (DEFERRED_CLIFF),
 *                        and a THEN tail behind a head still waiting on an event
 *                        (EVENT_CHAINED_TAIL) — no cliff, just a sequence that can't
 *                        be dated yet. (An event-anchored cliff used to land here
 *                        too; it now stores as a template — a time `cliff` plus an
 *                        `event_condition` — so `unrepresentable` is largely vacated
 *                        for cliffs.)
 *   - "impossible"       self-contradictory no matter what events fire (e.g. a date
 *                        required to fall after a strictly later date).
 */
export type InterchangeVerdict =
  | {
      status: "template";
      template: VestingScheduleTemplate;
      // Firing-invariant by construction: the interchange path is firing-blind, so
      // its runtime can carry no firings at all. `StoredTerms` makes that
      // unrepresentable rather than merely empty — eventFirings is `?: never`.
      runtime: StoredTerms;
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
      // blockers list. (A single contingent start no longer lands here — it stores
      // as a `template` via the sentinel + `evt:start` recipe; this arm is for the
      // shapes a record keeper can date but not collapse to one template, e.g.
      // multiple start origins.)
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
 * The claim is direction-aware, not single-polarity: `through` is the boundary date,
 * and `direction` + `inclusive` (the `AbsenceDescriptor`) say which side of it a
 * dangerous firing of `eventId` falls — so a consumer re-checks the side that could
 * actually flip the answer (a `BEFORE`/EARLIER OF watch is the on/before side, an
 * `AFTER`/LATER OF watch the on/after side). `consequence` then says how much is at
 * stake if that firing lands: `flips-to-impossible` (a gate the grant can't satisfy →
 * dead grant) vs `grid-shift` (a selector re-anchoring → the schedule just moves).
 */
export interface AbsenceAssumption extends AbsenceDescriptor {
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
