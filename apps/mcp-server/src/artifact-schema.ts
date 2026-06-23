// The zod schema for a persisted artifact — the rehydrate tool's input. It
// validates untrusted wire input (a stored artifact can be hand-edited in external
// storage) into a canonical `PersistedArtifact`, which the pipeline's orchestration
// then consumes. The shapes mirror the canonical interchange (`@vestlang/types`)
// and the evaluator's sidecar family. Only the schema lives here; the persist /
// rehydrate orchestration moved to `@vestlang/pipeline`.

import { z } from "zod";
import {
  VESTLANG_SIDECAR_NAMESPACE,
  type PersistedArtifact,
} from "@vestlang/evaluator";
import {
  NUMERIC_PATTERN_SOURCE,
  VESTING_DAY_OF_MONTH_VALUES,
} from "@vestlang/types";
import { ISO_DATE } from "./iso-date.js";

/* ------------------------
 * Zod schemas for the artifact (the rehydrate tool's input)
 * ------------------------ */

// A stored percentage is an OCF Numeric decimal string, validated against the
// single shared grammar from @vestlang/types. This rejects the old
// {numerator,denominator} object, scientific notation, and >10-place strings on
// untrusted wire input — the same shape validate.ts enforces.
const NUMERIC = z.string().regex(new RegExp(NUMERIC_PATTERN_SOURCE));

const PERIOD_TYPE = z.enum(["DAYS", "MONTHS", "YEARS"]);

// The OCT VestingDayOfMonth enum, as it rides in a stored runtime — derived from
// the canonical value array so a dropped value fails typecheck here too.
const VESTING_DAY_OF_MONTH = z.enum(VESTING_DAY_OF_MONTH_VALUES);

const CLIFF = z
  .object({
    length: z.number().int().min(0),
    period_type: PERIOD_TYPE,
    percentage: NUMERIC,
  })
  .strict();

// DATE-only: the canonical base anchors every statement on the one hoisted
// per-grant start (a contingent start is a DATE base on the sentinel startDate).
const TEMPLATE_VESTING_BASE = z.object({ type: z.literal("DATE") }).strict();

// The event hold on a statement's grid: the gating event's id (a real user event,
// or a reserved synthetic `evt:<n>` whose recipe lives in the sidecar). Carta's
// HYBRID performanceCondition, stored on the wire.
const EVENT_CONDITION = z.object({ event_id: z.string().min(1) }).strict();

const VESTING_STATEMENT = z
  .object({
    order: z.number().int(),
    vesting_base: TEMPLATE_VESTING_BASE,
    occurrences: z.number().int().min(1),
    period: z.number().int().min(0),
    period_type: PERIOD_TYPE,
    cliff: CLIFF.optional(),
    event_condition: EVENT_CONDITION.optional(),
    percentage: NUMERIC,
  })
  .strict();

const TEMPLATE = z
  .object({
    id: z.string(),
    statements: z.array(VESTING_STATEMENT),
  })
  .strict();

// The stored runtime is `StoredTerms` — firing-free by construction (eventFirings
// is unrepresentable on the type). The schema mirrors that: there is no
// `eventFirings` key, and `.strict()` rejects one if a hand-edited artifact tries
// to smuggle a baked firing in. Firing-invariance is enforced here on untrusted
// wire input, not just at the type level. Witnesses are re-derived from the world
// on every reload (see rehydrate).
const RUNTIME = z
  .object({
    startDate: ISO_DATE.optional(),
    grantDate: ISO_DATE.optional(),
    vestingDayOfMonth: VESTING_DAY_OF_MONTH.optional(),
  })
  .strict();

const SOURCE_MAP_ENTRY = z
  .object({
    definition: z.string(),
  })
  .strict();

// The sidecar is the namespaced bag whose `vestlang` key holds the source map.
const SIDECAR = z
  .object({
    [VESTLANG_SIDECAR_NAMESPACE]: z.record(z.string(), SOURCE_MAP_ENTRY),
  })
  .strict();

// `satisfies z.ZodType<PersistedArtifact>` pins the schema to the canonical type:
// drift between this wire schema and `@vestlang/evaluator`'s `PersistedArtifact`
// fails typecheck rather than slipping through silently.
export const PERSISTED_ARTIFACT = z
  .object({
    template: TEMPLATE,
    runtime: RUNTIME,
    sidecar: SIDECAR.optional(),
  })
  .strict()
  .describe(
    "A PersistedArtifact: the canonical template + runtime, plus the optional out-of-band sidecar (the source map of synthetic-event definitions). Typically the output of vestlang_persist.",
  ) satisfies z.ZodType<PersistedArtifact>;
