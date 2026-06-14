// The persistence lifecycle, exposed as a tool pair. The shapes here mirror the
// canonical interchange (`@vestlang/types`) and the evaluator's sidecar family;
// this module owns the zod schemas for the persisted artifact and the delta
// computation that turns a rehydration into an action list against the system of
// record.
//
// Lifecycle, per the demo story: author DSL → compile once → store the canonical
// template + runtime + sidecar (the out-of-band source map of synthetic-event
// definitions) → as real-world events fire, rehydrate to learn WHICH synthetic
// events to now fire in the system of record (Carta) and WHAT projection they'll
// produce once fired.

import { z } from "zod";
import {
  parseToProgram,
  errorFindings,
  formatFinding,
} from "@vestlang/pipeline";
import { lintText } from "@vestlang/linter";
import {
  evaluateProgram,
  toPersisted,
  rehydratePersisted,
  fromSidecar,
  isImpossibleBlocker,
  VESTLANG_SIDECAR_NAMESPACE,
  type PersistedArtifact,
} from "@vestlang/evaluator";
import { compileToInstallments } from "@vestlang/core";
import { VESTING_DAY_OF_MONTH_VALUES } from "@vestlang/types";
import type {
  EvaluationContextInput,
  ImpossibleBlocker,
  OCTDate,
  UnresolvedBlocker,
  VestingRuntime,
} from "@vestlang/types";

// A firing entry as it lives in VestingRuntime.eventFirings. Re-stated locally so
// the zod schema and the delta logic share one shape.
type EventFiring = NonNullable<VestingRuntime["eventFirings"]>[number];

/* ------------------------
 * Zod schemas for the artifact (the rehydrate tool's input)
 * ------------------------ */

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");

const FRACTION = z
  .object({
    numerator: z.number().int(),
    denominator: z.number().int().min(1),
  })
  .strict();

const PERIOD_TYPE = z.enum(["DAYS", "MONTHS", "YEARS"]);

// The OCT VestingDayOfMonth enum, as it rides in a stored runtime — derived from
// the canonical value array so a dropped value fails typecheck here too.
const VESTING_DAY_OF_MONTH = z.enum(VESTING_DAY_OF_MONTH_VALUES);

const CLIFF = z
  .object({
    length: z.number().int().min(0),
    period_type: PERIOD_TYPE,
    percentage: FRACTION,
  })
  .strict();

const TEMPLATE_VESTING_BASE = z.union([
  z.object({ type: z.literal("DATE") }).strict(),
  z.object({ type: z.literal("EVENT"), event_id: z.string().min(1) }).strict(),
]);

const VESTING_STATEMENT = z
  .object({
    order: z.number().int(),
    vesting_base: TEMPLATE_VESTING_BASE,
    occurrences: z.number().int().min(1),
    period: z.number().int().min(0),
    period_type: PERIOD_TYPE,
    cliff: CLIFF.optional(),
    percentage: FRACTION,
  })
  .strict();

const TEMPLATE = z
  .object({
    id: z.string(),
    statements: z.array(VESTING_STATEMENT),
  })
  .strict();

const EVENT_FIRING = z
  .object({
    event_id: z.string().min(1),
    date: ISO_DATE,
    realized_fraction: FRACTION.optional(),
  })
  .strict();

const RUNTIME = z
  .object({
    startDate: ISO_DATE.optional(),
    eventFirings: z.array(EVENT_FIRING).optional(),
    grantDate: ISO_DATE.optional(),
    vestingDayOfMonth: VESTING_DAY_OF_MONTH.optional(),
  })
  .strict();

const SOURCE_MAP_ENTRY = z
  .object({
    definition: z.string(),
    label: z.string().optional(),
  })
  .strict();

// The sidecar is the namespaced bag whose `vestlang` key holds the source map.
const SIDECAR = z
  .object({
    [VESTLANG_SIDECAR_NAMESPACE]: z.record(z.string(), SOURCE_MAP_ENTRY),
  })
  .strict();

export const PERSISTED_ARTIFACT = z
  .object({
    template: TEMPLATE,
    runtime: RUNTIME,
    sidecar: SIDECAR.optional(),
  })
  .strict()
  .describe(
    "A PersistedArtifact: the canonical template + runtime, plus the optional out-of-band sidecar (the source map of synthetic-event definitions). Typically the output of vestlang_persist.",
  );

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

export type PersistResult =
  | { ok: true; artifact: PersistedArtifact; blockers: unknown[] }
  | { ok: false; error: string };

// Compile a program down to a storable artifact. Three gates stand in the way, in
// order. First, lint: a program the linter flags with an error-severity diagnostic
// — e.g. a start gate whose date window is empty — is refused before we evaluate,
// naming the diagnostic. Then validity: a program the evaluator flags as invalid —
// one that allocates more than the whole grant — is refused, naming the
// over-allocation, since storing it would mint a durable artifact that over-vests on
// rehydrate. Finally storability: only a `template` resolution fits a single
// canonical artifact, so any other shape comes back as a clear error naming the
// status that blocked it. The returned blockers are the template arm's advisory
// pending witnesses — what's still floating at store time (e.g. a combinator start
// whose event hasn't fired), surfaced so the caller knows the artifact isn't yet
// fully resolved.
export function runPersist(input: PersistInput): PersistResult {
  const parsed = parseToProgram(input.dsl);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error.message };
  }

  // A program the linter rejects as an error must not become a durable artifact.
  // Key on error severity, not "any diagnostic": a warning (e.g. cliff-exceeds-span)
  // is advisory and leaves the schedule storable. lintText is the same entry the
  // vestlang_lint tool uses, so persist and lint share one analysis path. Static
  // and cheap, so it runs before the heavier evaluate.
  const lintErrors = lintText(input.dsl).diagnostics.filter(
    (d) => d.severity === "error",
  );
  if (lintErrors.length > 0) {
    return {
      ok: false,
      error: `Cannot persist: ${lintErrors
        .map((d) => `${d.ruleId}: ${d.message}`)
        .join("; ")}.`,
    };
  }

  const ctxInput: EvaluationContextInput = {
    grantDate: input.grant_date,
    events: { ...(input.events ?? {}) },
    grantQuantity: input.grant_quantity,
    asOf: input.grant_date,
    ...(input.vesting_day_of_month
      ? { vesting_day_of_month: input.vesting_day_of_month }
      : {}),
  };

  let schedule;
  try {
    [schedule] = evaluateProgram(parsed.program, ctxInput);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Validity comes before shape: when a schedule is both invalid and non-template,
  // refuse it for the real defect (over-allocation) rather than the incidental shape.
  const errors = errorFindings(schedule.findings);
  if (errors.length > 0) {
    return {
      ok: false,
      error: `Cannot persist: ${errors.map(formatFinding).join("; ")}.`,
    };
  }

  const resolution = schedule.resolution;
  if (resolution.status !== "template") {
    return {
      ok: false,
      error: `Only a template-resolution program is storable as a persisted artifact; this program resolved to "${resolution.status}". Adjust the schedule so it collapses to a single canonical template.`,
    };
  }

  const artifact = toPersisted({
    template: resolution.template,
    runtime: resolution.runtime,
    sourceMap: resolution.sourceMap,
  });
  return { ok: true, artifact, blockers: resolution.blockers };
}

/* ------------------------
 * rehydrate: artifact + world's firings → action list + pending + dead + projection
 * ------------------------ */

// One entry in the action list: a synthetic witness that the rehydration newly
// resolved (or moved). `definition` is looked up from the sidecar so a human sees
// WHY the synthetic event resolved to this date.
interface FiringToApply {
  event_id: string;
  date: OCTDate;
  definition: string | null;
}

export interface RehydrateInput {
  artifact: PersistedArtifact;
  grant_quantity: number;
  events?: Record<string, OCTDate>;
  as_of?: OCTDate;
}

// The success payload, also the shape the server returns once it strips `ok`. The
// evaluator hands back one flat blocker list; we split it into the two operator
// readings: `pending` is still-waiting (the gating event hasn't fired), `dead` can
// never resolve given the firings we now know (the event fired outside its window).
interface RehydrateOutput {
  firings_to_apply: FiringToApply[];
  pending: UnresolvedBlocker[];
  dead: ImpossibleBlocker[];
  projection: ReturnType<typeof compileToInstallments>;
}

// Mirrors PersistResult: a clean success or a refusal carrying a clear message.
// The only refusal today is a hand-built artifact with no stored grant date.
export type RehydrateResult =
  | ({ ok: true } & RehydrateOutput)
  | { ok: false; error: string };

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
  // The grant date is the artifact's, not the caller's — it now feeds both the
  // witness re-resolution and the as_of default, so a missing one would silently
  // resolve everything against undefined. Persist always stores it; only a
  // hand-built artifact can omit it, and we turn that away up front.
  const grantDate = input.artifact.runtime.grantDate;
  if (grantDate === undefined) {
    return {
      ok: false,
      error:
        "Cannot rehydrate: the artifact's runtime is missing its stored grant date (runtime.grantDate). A persisted artifact always carries it; supply one built by vestlang_persist.",
    };
  }

  const ctxInput: EvaluationContextInput = {
    grantDate,
    events: { ...(input.events ?? {}) },
    grantQuantity: input.grant_quantity,
    asOf: input.as_of ?? grantDate,
  };

  const result = rehydratePersisted(input.artifact, ctxInput);

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

  // Partition the flat blocker list by each blocker's own verdict. Contradictions
  // (the gate's event fired outside its window) go to `dead` — stop waiting; the
  // rest are genuinely still-waiting and stay in `pending`. Both are always present
  // ([] when empty) so the caller never has to probe for the field.
  const dead = result.blockers.filter(isImpossibleBlocker);
  const pending = result.blockers.filter(
    (b): b is UnresolvedBlocker => !isImpossibleBlocker(b),
  );

  return {
    ok: true,
    firings_to_apply,
    pending,
    dead,
    projection,
  };
}
