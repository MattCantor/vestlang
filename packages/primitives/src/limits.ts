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
