import type { EvaluatedSchedule } from "@vestlang/types";

/**
 * The consumer rule, made explicit. There are four orthogonal reads of an
 * `EvaluatedSchedule`, each keyed off a different field:
 *
 *   representable  from `status`        can the canonical interchange hold the spec?
 *   pending        from `blockers`      are witnesses still missing? (never read this
 *                                       from `status === "unresolved"`)
 *   projected      from `installments`  is there a dated projection yet?
 *   valid          from `findings`      is the spec legal (≤ 100% of the grant)?
 *
 * The pending template is the case this exists for: a `status` of `template`
 * (representable) together with blockers present (pending). Surfaces must not let
 * that collapse into "complete".
 *
 * `valid` is deliberately separate from `representable`: "the interchange can hold
 * this spec" and "this spec is legal" are different questions, and they can
 * disagree. A schedule can be representable, still pending, and yet over-allocate —
 * e.g. "3/4 now PLUS 3/4 once the IPO fires": the 750 shares vested today are
 * perfectly legal, but the schedule reaches 150% of the grant once the IPO fires.
 *
 * The rule for that collision is annotate, don't certify: a surface should still
 * show whatever has legitimately vested, but must not present an over-allocating
 * schedule as the certified-valid answer. Hiding the legal partial projection just
 * because the schedule over-allocates later is the wrong direction.
 */
export interface SchedulePresentation {
  /** The spec is held by a canonical layer: `template` or `events-only`. */
  representable: boolean;
  /**
   * The projection is waiting on witnesses — read from the presence of
   * blockers, excluding the terminal `impossible` arm (whose blockers are
   * contradictions, not missing witnesses). True for an `unresolved` schedule
   * AND for a `template`/`events-only` that still carries blockers.
   */
  pending: boolean;
  /** At least one dated (RESOLVED) installment exists. */
  projected: boolean;
  /** No error-level finding — i.e. the schedule allocates at most the whole grant. */
  valid: boolean;
}

/** Derive the orthogonal reads from an evaluated schedule. */
export function presentSchedule(s: EvaluatedSchedule): SchedulePresentation {
  return {
    representable: s.status === "template" || s.status === "events-only",
    pending: s.status !== "impossible" && s.blockers.length > 0,
    projected: s.installments.some((i) => i.meta.state === "RESOLVED"),
    valid: s.findings.every((f) => f.severity !== "error"),
  };
}
