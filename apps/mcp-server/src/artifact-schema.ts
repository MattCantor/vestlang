// The zod schema for a persisted artifact — the rehydrate tool's input. It
// validates untrusted wire input (a stored artifact can be hand-edited in external
// storage) into a canonical `PersistedArtifact`, which the pipeline's orchestration
// then consumes. The shapes mirror the canonical interchange (`@vestlang/types`)
// and the evaluator's sidecar family. Only the schema lives here; the persist /
// rehydrate orchestration moved to `@vestlang/pipeline`.
//
// The canonical *template* (and its scalars) is no longer declared here — it's
// imported from the one shared schema in `@vestlang/primitives`, so this surface
// can't drift from the compiler's. The wrapper, the runtime, the sidecar, and the
// ISO-date scalar stay local: the runtime is a *firing-free* shape this server
// owns, and the wrapper carries the `satisfies`/`.describe` the MCP server needs.

import { z } from "zod";
import {
  VESTLANG_SIDECAR_NAMESPACE,
  type PersistedArtifact,
} from "@vestlang/evaluator";
import { TEMPLATE } from "@vestlang/primitives";
import { VESTING_DAY_OF_MONTH_VALUES } from "@vestlang/types";
import { ISO_DATE } from "./iso-date.js";

/* ------------------------
 * Zod schemas for the artifact (the rehydrate tool's input)
 * ------------------------ */

// The OCT VestingDayOfMonth enum, as it rides in a stored runtime — derived from
// the canonical value array so a dropped value fails typecheck here too.
const VESTING_DAY_OF_MONTH = z.enum(VESTING_DAY_OF_MONTH_VALUES);

// The stored runtime is `StoredTerms` — firing-free by construction (eventFirings
// is unrepresentable on the type). The schema mirrors that: there is no
// `eventFirings` key, and the strict object rejects one if a hand-edited artifact
// tries to smuggle a baked firing in. Firing-invariance is enforced here on untrusted
// wire input, not just at the type level. Witnesses are re-derived from the world
// on every reload (see rehydrate).
const RUNTIME = z.strictObject({
  startDate: ISO_DATE.optional(),
  grantDate: ISO_DATE.optional(),
  vestingDayOfMonth: VESTING_DAY_OF_MONTH.optional(),
});

const SOURCE_MAP_ENTRY = z.strictObject({
  definition: z.string(),
});

// The sidecar is the namespaced bag whose `vestlang` key holds the source map.
const SIDECAR = z.strictObject({
  [VESTLANG_SIDECAR_NAMESPACE]: z.record(z.string(), SOURCE_MAP_ENTRY),
});

// `satisfies z.ZodType<PersistedArtifact>` pins the schema to the canonical type:
// drift between this wire schema and `@vestlang/evaluator`'s `PersistedArtifact`
// fails typecheck rather than slipping through silently. The nested `template` is
// the shared Mini schema; a full-zod object accepts a Mini child at runtime.
export const PERSISTED_ARTIFACT = z
  .strictObject({
    template: TEMPLATE,
    runtime: RUNTIME,
    sidecar: SIDECAR.optional(),
  })
  .describe(
    "A PersistedArtifact: the canonical template + runtime, plus the optional out-of-band sidecar (the source map of synthetic-event definitions). Typically the output of vestlang_persist.",
  ) satisfies z.ZodType<PersistedArtifact>;
