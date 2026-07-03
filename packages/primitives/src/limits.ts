// The installment-cap constant, shared across the schedule producers.

// Upper bound on the installments a single schedule may materialize, summed
// across its statements. Vesting that expands past this is almost always a
// fat-fingered cadence (`OVER 1000000 months EVERY 1 month`); without the bound,
// building the array is a denial-of-service (stack overflow / OOM). The template
// validator, the evaluator's pre-expansion guard, and the linter's authoring-time
// rule all enforce it — so the limit and its message live in one place.
export const MAX_INSTALLMENTS = 10_000;

/** The one spelling of the over-cap error, shared by the template validator,
 *  the evaluator's pre-expansion guard, and the linter's installment-cap rule. */
export const installmentCapMessage = (total: number): string =>
  `schedule expands to ${total} installments, exceeds the limit of ${MAX_INSTALLMENTS}`;

// Upper bound on the entries in a single evaluation's events map. Events are
// keyed by name, and a real grant references a handful to a few dozen; 1000 is
// generous headroom while keeping the record a trivial memory bound. The
// evaluator's context guard and the MCP boundary schema both enforce it, so an
// oversized client-supplied map is refused before it's walked.
export const MAX_EVENTS = 1000;

/** The over-cap message the evaluator's context guard throws for an oversized
 *  events map; reports the actual entry count and the limit. */
export const eventsCapMessage = (count: number): string =>
  `events has ${count} entries, exceeds the limit of ${MAX_EVENTS}`;
