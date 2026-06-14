import type { EvaluatedSchedule } from "@vestlang/types";
import { errorFindings } from "./findings.js";

/**
 * The consumer rule, made explicit. There are five orthogonal reads of an
 * `EvaluatedSchedule`, and the point of this function is that each comes from a
 * different place — getting them from the right place is what keeps them honest:
 *
 *   representable  from `interchange`   can the record keeper hold this spec? This
 *                                       is the firing-invariant verdict, so the
 *                                       answer doesn't lurch around as events fire.
 *   pending        from `resolution`    are witnesses still missing? (read the
 *                                       `pending` blocker list, not the status)
 *   dead           from `resolution`    is anything contradicted given the firings?
 *                                       (read the `dead` blocker list)
 *   projected      from `resolution`    is there a dated projection yet?
 *   valid          from `findings`      is the spec legal (≤ 100% of the grant)?
 *
 * The pending template is the case this exists for: a representable schedule that
 * still carries pending blockers. Surfaces must not let that collapse into
 * "complete". And `dead` is its mirror: a schedule with one fully-dated statement
 * plus one statement that fired outside its window classifies `unresolved`, yet has
 * nothing waiting — only something dead — so it must read `pending: false`,
 * `dead: true`, not the other way round.
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
   * The projection is waiting on witnesses — read off `resolution.pending`, the
   * still-merely-waiting blockers. True for an `unresolved` schedule AND for a
   * `template`/`events-only` that still carries pending blockers. Independent of
   * `dead`: a schedule can be both (one statement waiting, another dead).
   */
  pending: boolean;
  /**
   * At least one blocker is dead — contradicted given the firings we know, so it
   * can never resolve. Read off `resolution.dead`. Distinct from a terminal
   * `impossible` status: a single dead statement beside a live one leaves the
   * schedule `unresolved` but still surfaces the deadness here.
   */
  dead: boolean;
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
    pending: resolution.pending.length > 0,
    dead: resolution.dead.length > 0,
    projected: resolution.installments.some((i) => i.state === "RESOLVED"),
    valid: errorFindings(s.findings).length === 0,
  };
}
