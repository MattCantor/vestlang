import type { EvaluatedSchedule } from "@vestlang/types";

/**
 * The consumer rule, made explicit. There are three orthogonal reads of an
 * `EvaluatedSchedule`, each keyed off a different field:
 *
 *   representable  from `status`        can the canonical interchange hold the spec?
 *   pending        from `blockers`      are witnesses still missing? (never read this
 *                                       from `status === "unresolved"`)
 *   projected      from `installments`  is there a dated projection yet?
 *
 * The pending template is the case this exists for: a `status` of `template`
 * (representable) together with blockers present (pending). Surfaces must not let
 * that collapse into "complete".
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
}

/** Derive the three orthogonal reads from an evaluated schedule. */
export function presentSchedule(s: EvaluatedSchedule): SchedulePresentation {
  return {
    representable: s.status === "template" || s.status === "events-only",
    pending: s.status !== "impossible" && s.blockers.length > 0,
    projected: s.installments.some((i) => i.meta.state === "RESOLVED"),
  };
}
