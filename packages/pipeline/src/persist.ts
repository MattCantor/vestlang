// The persistence lifecycle's orchestration: persist a DSL program down to a
// storable artifact, and rehydrate that artifact against the world's firings. Both
// route context construction through the pipeline's internal `buildContext`.
// Neither reads an observation date — they resolve a schedule's structural state
// (which template, which witnesses), and that is the same whenever you ask — so
// neither touches the wall-clock `todayISO()` default the as-of path uses.
//
// Lifecycle, per the demo story: author DSL → compile once → store the canonical
// template + runtime + sidecar (the out-of-band source map of synthetic-event
// definitions) → as real-world events fire, rehydrate to learn WHICH synthetic
// events to now fire in the system of record (Carta) and WHAT projection they'll
// produce once fired.
//
// The zod schemas that validate wire input into a `PersistedArtifact` stay in the
// MCP app; only the orchestration moved here. Both orchestrators return the
// package's shared `Result<T>`, so a refusal carries a structured `PipelineError`
// (a `ruleId` plus message) the same way the evaluate-family does.

import {
  evaluateProgram,
  toPersisted,
  rehydratePersisted,
  fromSidecar,
  isRehydrateDefinitionError,
  isSyntheticNamespaceError,
  templateAllocationFindings,
  type PersistedArtifact,
} from "@vestlang/evaluator";
import { errorDiagnostics, lintText } from "@vestlang/linter";
import { compileToInstallments } from "@vestlang/core";
import type {
  DeadBlocker,
  OCTDate,
  UnresolvedBlocker,
  VestingRuntime,
} from "@vestlang/types";
import { parseToProgram, toEvaluationError, type Result } from "./parse.js";
import { buildContext } from "./context.js";
import { errorFindings, formatFinding } from "./findings.js";

// A firing entry as it lives in VestingRuntime.eventFirings. Re-stated locally so
// the delta logic has one shape. Module-private — it never appears in a public
// signature.
type EventFiring = NonNullable<VestingRuntime["eventFirings"]>[number];

/* ------------------------
 * persist: DSL + grant context → a storable artifact
 * ------------------------ */

export interface PersistInput {
  dsl: string;
  grant_date: OCTDate;
  grant_quantity: number;
  events?: Record<string, OCTDate>;
  vesting_day_of_month?: VestingRuntime["vestingDayOfMonth"];
}

// The success arm's blockers, split to match the evaluate/rehydrate shape. They
// come from the closed-world `resolution` (the only verdict with blocker
// vocabulary): `pending` are witnesses still floating at store time, `dead` are
// blockers contradicted given the firings recorded so far. `dead` CAN be non-empty
// here — a schedule storable firing-blind (the interchange gate passed) may still
// be dead given a firing the system of record has already seen, a revisable
// disclosure (events are owned by the system of record, not the artifact).
export type PersistResult = Result<{
  artifact: PersistedArtifact;
  pending: UnresolvedBlocker[];
  dead: DeadBlocker[];
}>;

// Compile a program down to a storable artifact. Three gates stand in the way, in
// order. First, lint: a program the linter flags with an error-severity diagnostic
// — e.g. a start gate whose date window is empty — is refused before we evaluate,
// naming the diagnostic. Then validity: a program the evaluator flags as invalid —
// one that allocates more than the whole grant — is refused, naming the
// over-allocation, since storing it would mint a durable artifact that over-vests on
// rehydrate. Finally storability: only a `template` *interchange* verdict fits a
// single canonical artifact, so any other shape comes back as a clear error naming
// the status that blocked it.
//
// The storability gate reads the firing-invariant `interchange` verdict, NOT
// `resolution`. They can diverge: after the EARLIER_OF commit, an EARLIER_OF cliff
// resolves to `template` while its interchange stays `unrepresentable` — gating on
// resolution would silently make an unstorable schedule storable (AC 7). The
// artifact (template + StoredTerms runtime + sourceMap) is built from interchange
// too, so it's firing-invariant by construction.
//
// The returned `pending`/`dead` come from `resolution` (the verdict that speaks
// blocker vocabulary): `pending` are witnesses still floating at store time (e.g. a
// combinator start whose event hasn't fired); `dead` may be non-empty — a schedule
// storable firing-blind yet dead given the firings recorded so far.
//
// Persist resolves the program's storable structure — which canonical template it
// is — and that doesn't depend on when you look, so no observation date enters.
export function runPersist(input: PersistInput): PersistResult {
  const parsed = parseToProgram(input.dsl);
  if (!parsed.ok) {
    // Parsed `input.dsl` directly (no synthetic wrap), so the parser's error —
    // its `syntax-error` ruleId, message, and `loc` span — already points at the
    // user's own source. Propagate it verbatim.
    return parsed;
  }

  // A program the linter rejects as an error must not become a durable artifact.
  // Key on error severity, not "any diagnostic": a warning (e.g. cliff-exceeds-span)
  // is advisory and leaves the schedule storable. lintText is the same entry the
  // vestlang_lint tool uses, so persist and lint share one analysis path. Static
  // and cheap, so it runs before the heavier evaluate.
  const lintErrors = errorDiagnostics(lintText(input.dsl).diagnostics);
  if (lintErrors.length > 0) {
    return {
      ok: false,
      error: {
        ruleId: "persist-not-storable",
        message: `Cannot persist: ${lintErrors
          .map((d) => `${d.ruleId}: ${d.message}`)
          .join("; ")}.`,
      },
    };
  }

  const ctx = buildContext({
    grant_date: input.grant_date,
    events: input.events,
    grant_quantity: input.grant_quantity,
    vesting_day_of_month: input.vesting_day_of_month,
  });

  let schedule;
  try {
    schedule = evaluateProgram(parsed.program, ctx);
  } catch (err) {
    return { ok: false, error: toEvaluationError(err) };
  }

  // Validity comes before shape: when a schedule is both invalid and non-template,
  // refuse it for the real defect (over-allocation) rather than the incidental shape.
  const errors = errorFindings(schedule.findings);
  if (errors.length > 0) {
    return {
      ok: false,
      error: {
        ruleId: "persist-not-storable",
        message: `Cannot persist: ${errors.map(formatFinding).join("; ")}.`,
      },
    };
  }

  // Gate on the firing-invariant interchange verdict — that's what determines
  // whether the schedule has a single storable canonical form at all. (Resolution
  // can read `template` for a schedule whose interchange is unrepresentable, e.g.
  // an EARLIER_OF cliff that commits its floor; gating on it would store the
  // unstorable.)
  const interchange = schedule.interchange;
  if (interchange.status !== "template") {
    return {
      ok: false,
      error: {
        ruleId: "persist-not-storable",
        message: `Only a single-template program is storable as a persisted artifact; this program's storable form is "${interchange.status}". Adjust the schedule so it collapses to a single canonical template.`,
      },
    };
  }

  // The artifact is built from interchange: its runtime is StoredTerms (firing-
  // free), so the artifact is firing-invariant by construction.
  const artifact = toPersisted({
    template: interchange.template,
    runtime: interchange.runtime,
    sourceMap: interchange.sourceMap,
  });
  // pending/dead come from resolution (the verdict with blocker vocabulary). A
  // storable schedule may legitimately carry a non-empty `dead` here — see the
  // PersistResult note above.
  return {
    ok: true,
    artifact,
    pending: schedule.resolution.pending,
    dead: schedule.resolution.dead,
  };
}

/* ------------------------
 * rehydrate: artifact + world's firings → action list + pending + dead + projection
 * ------------------------ */

// One entry in the action list: a synthetic witness that the rehydration newly
// resolved (or moved). `definition` is looked up from the sidecar so a human sees
// WHY the synthetic event resolved to this date.
export interface FiringToApply {
  event_id: string;
  date: OCTDate;
  definition: string | null;
}

export interface RehydrateInput {
  artifact: PersistedArtifact;
  grant_quantity: number;
  events?: Record<string, OCTDate>;
}

// The success payload, also the shape the server returns once it strips `ok`. The
// evaluator already partitions its blockers into the two operator readings:
// `pending` is still-waiting (the gating event hasn't fired), `dead` can never
// resolve given the firings we now know (the event fired outside its window).
export interface RehydrateOutput {
  firings_to_apply: FiringToApply[];
  pending: UnresolvedBlocker[];
  dead: DeadBlocker[];
  projection: ReturnType<typeof compileToInstallments>;
}

// Mirrors PersistResult: a clean success or a structured refusal. Refusals all
// signal a damaged artifact — a missing stored grant date, a corrupt event
// definition, or a template that allocates more than the whole grant — each under
// its own ruleId so a consumer can remediate them differently.
export type RehydrateResult = Result<RehydrateOutput>;

// The delta: synthetic witnesses present in the rehydrated runtime's eventFirings
// but absent — or sitting on a different date — versus the input artifact's stored
// runtime. That difference is exactly the set of firings a vestlang-aware operator
// must now apply in the system of record. We index both sides by event_id and keep
// an entry when it's new or its date moved.
function computeDelta(
  before: readonly EventFiring[],
  after: readonly EventFiring[],
  definitionFor: (eventId: string) => string | null,
): FiringToApply[] {
  const priorByDate = new Map(before.map((f) => [f.event_id, f.date]));
  const delta: FiringToApply[] = [];
  for (const firing of after) {
    const prior = priorByDate.get(firing.event_id);
    if (prior === firing.date) continue; // unchanged — nothing to apply
    delta.push({
      event_id: firing.event_id,
      date: firing.date,
      definition: definitionFor(firing.event_id),
    });
  }
  return delta;
}

export function runRehydrate(input: RehydrateInput): RehydrateResult {
  // The grant date is the artifact's, not the caller's — it feeds the witness
  // re-resolution, so a missing one would silently resolve everything against
  // undefined. Persist always stores it; only a hand-built artifact can omit it,
  // and we turn that away up front.
  const grantDate = input.artifact.runtime.grantDate;
  if (grantDate === undefined) {
    return {
      ok: false,
      error: {
        ruleId: "rehydrate-missing-grant-date",
        message:
          "Cannot rehydrate: the artifact's runtime is missing its stored grant date (runtime.grantDate). A persisted artifact always carries it; supply one built by vestlang_persist.",
      },
    };
  }

  // A persisted artifact can also arrive over-allocating — a hand-built or foreign
  // one whose statement percentages sum past 100% — which would otherwise rehydrate
  // to a projection that vests more than the whole grant. Re-check the stored
  // template's allocation up front, mirroring persist's #226 store-time gate, so the
  // over-vesting stream never materializes. The check reads the template alone
  // (firing-independent), so it runs before any witness re-resolution. Sharing the
  // evaluator's primitive keeps this rule and persist's in lockstep.
  const allocationErrors = errorFindings(
    templateAllocationFindings(input.artifact.template, input.grant_quantity),
  );
  if (allocationErrors.length > 0) {
    return {
      ok: false,
      error: {
        ruleId: "rehydrate-over-allocation",
        message: `Cannot rehydrate: ${allocationErrors
          .map(formatFinding)
          .join(
            "; ",
          )}. The artifact appears to be damaged; supply one built by vestlang_persist.`,
      },
    };
  }

  const ctx = buildContext({
    grant_date: grantDate,
    events: input.events,
    grant_quantity: input.grant_quantity,
  });

  // A persisted artifact can be edited in external storage, so a stored event
  // definition may arrive corrupt — unparseable, or smuggling in a second statement
  // that would otherwise be silently dropped. The evaluator throws a tagged
  // RehydrateDefinitionError on that path; we turn it into the same structured
  // refusal as the missing-grant-date case, naming the offending event but NOT
  // echoing the raw parser text (that stays on the error's `cause`, for logs). Any
  // other throw is unexpected — re-throw it, matching runPersist's split (it catches
  // only evaluateProgram and lets the rest propagate).
  let result;
  try {
    result = rehydratePersisted(input.artifact, ctx);
  } catch (err) {
    if (isRehydrateDefinitionError(err)) {
      return {
        ok: false,
        error: {
          ruleId: "rehydrate-corrupt-definition",
          message: `Cannot rehydrate: the stored definition for event "${err.event_id}" is corrupt or unparseable. The artifact appears to be damaged; supply one built by vestlang_persist.`,
        },
      };
    }
    // A sidecar key outside the reserved synthetic namespace aliases a real user
    // event — distinct from an unparseable definition (this path never reparses).
    // Name the offending key; carry no raw parser text.
    if (isSyntheticNamespaceError(err)) {
      return {
        ok: false,
        error: {
          ruleId: "rehydrate-namespace-violation",
          message: `Cannot rehydrate: the sidecar key "${err.event_id}" is outside the reserved synthetic event namespace, so it would alias a real user event. The artifact appears to be damaged; supply one built by vestlang_persist.`,
        },
      };
    }
    throw err;
  }

  // Look the definition up from the sidecar's source map, so the operator sees the
  // gate behind each newly-resolved synthetic id rather than a bare `evt:n`.
  const sourceMap = fromSidecar(input.artifact.sidecar);
  const definitionFor = (eventId: string): string | null =>
    sourceMap[eventId]?.definition ?? null;

  const firings_to_apply = computeDelta(
    input.artifact.runtime.eventFirings ?? [],
    result.runtime.eventFirings ?? [],
    definitionFor,
  );

  // What the system of record will show once those firings are applied: the frozen
  // template compiled against the witness-updated runtime, with the supplied grant
  // quantity as the total to allocate.
  const projection = compileToInstallments(
    input.artifact.template,
    input.grant_quantity,
    result.runtime,
  );

  // The evaluator already split its blockers by verdict: contradictions (the gate's
  // event fired outside its window) in `dead` — stop waiting; the genuinely
  // still-waiting ones in `pending`. Both are always present ([] when empty), so the
  // caller never has to probe for the field.
  return {
    ok: true,
    firings_to_apply,
    pending: result.pending,
    dead: result.dead,
    projection,
  };
}
