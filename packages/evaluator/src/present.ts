import type { EvaluatedSchedule } from "@vestlang/types";

/**
 * The consumer rule, made explicit. There are four orthogonal reads of an
 * `EvaluatedSchedule`, and the point of this function is that each comes from a
 * different place — getting them from the right place is what keeps them honest:
 *
 *   representable  from `interchange`   can the record keeper hold this spec? This
 *                                       is the firing-invariant verdict, so the
 *                                       answer doesn't lurch around as events fire.
 *   pending        from `resolution`    are witnesses still missing? (read the
 *                                       blockers, not `status === "unresolved"`)
 *   projected      from `resolution`    is there a dated projection yet?
 *   valid          from `findings`      is the spec legal (≤ 100% of the grant)?
 *
 * The pending template is the case this exists for: a representable schedule that
 * still carries blockers. Surfaces must not let that collapse into "complete".
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
  const { interchange, resolution } = s;
  return {
    representable:
      interchange.status === "template" || interchange.status === "events-only",
    pending:
      resolution.status !== "impossible" && resolution.blockers.length > 0,
    projected: resolution.installments.some((i) => i.meta.state === "RESOLVED"),
    valid: s.findings.every((f) => f.severity !== "error"),
  };
}
