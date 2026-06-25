import type {
  EvaluatedSchedule,
  EvaluatedScheduleVerdict,
  NonTemplateReason,
  VestingDayOfMonth,
} from "@vestlang/types";
import type { StatementContribution } from "@vestlang/evaluator";

/** An evaluated schedule whose resolution verdict is specifically a template. */
type TemplateResolution = EvaluatedSchedule & {
  resolution: Extract<EvaluatedScheduleVerdict, { status: "template" }>;
};

// The result of running a program through the recovery pass.
//
// Discriminated on `rescued`, not on the schedule's verdict: a program that was
// already a template short-circuits with no rescue, so the verdict alone can't
// tell you whether recovery actually fired. The `rescued:true` arm narrows the
// schedule's resolution to the template variant and guarantees the recovery
// payload, so callers don't re-check either.
//
// `contributions` is the ORIGINAL author program's per-statement partition of the
// headline allocation (the breakdown amounts), present on both arms: on the
// no-rescue arm it's the program's own partition; on the rescued arm it's
// explicitly the pre-rescue partition, so the breakdown attributes to the author's
// clauses even after the verdict flipped to a synthesized template. Eval-time-only
// — it never reaches a stored/wire shape.
export type RecoveryOutcome =
  | {
      rescued: false;
      schedule: EvaluatedSchedule;
      contributions: StatementContribution[];
    }
  | {
      rescued: true;
      schedule: TemplateResolution;
      recovered: RecoveredTemplate;
      contributions: StatementContribution[];
    };

export interface RecoveredTemplate {
  /** What the program was rescued from — always "events-only" today. */
  from: "events-only";
  /** The original events-only reason (structured), captured before the verdict
   *  was replaced with the template. Without this the provenance is lost: the
   *  published schedule is now a template and carries no reason of its own. */
  reason: NonTemplateReason;

  // From the inferrer.
  dsl: string;
  /** Day-of-month convention the inferrer recovered. It is NOT encoded in the
   *  DSL text, so it has to travel separately to re-project faithfully. */
  vestingDayOfMonth: VestingDayOfMonth;

  /** recover's own residual, recomputed independently of the inferrer's. 0 on a
   *  sound rescue; kept for auditability. */
  residualError: number;
}
