import { describe, expect, it } from "vitest";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  ResolutionContextInput,
  NonTemplateReason,
  OCTDate,
} from "@vestlang/types";
import { inferSchedule } from "../src/index.js";
import type { HypothesisFamily, TrancheInput } from "../src/types.js";

// Render an events-only reason to the legible sentence the snapshot pins. The
// production prose renderer (`reasonToString`) lives in the pipeline's
// presentation layer, which the inferrer can't depend on (it sits below
// recover → pipeline). This test only ever exercises OVERLAPPING_ABSOLUTE_STARTS,
// but the other arms are spelled out so a new reason kind shows up here rather
// than going silently unrendered.
const renderReason = (r: NonTemplateReason): string => {
  switch (r.kind) {
    case "OVERLAPPING_ABSOLUTE_STARTS":
      return (
        r.detail ?? "Two independent absolute-date vesting grids on one grant."
      );
    case "MULTIPLE_START_ORIGINS":
      return r.detail ?? "More than one distinct start origin on one grant.";
    case "EVENT_CHAINED_TAIL":
      return (
        r.detail ??
        `A THEN segment chained behind a start waiting on event "${r.eventId}" can't be dated until that event fires.`
      );
    case "IMPOSSIBLE_COMPONENT":
      return (
        r.detail ??
        "A statically-impossible component on this grant can never be stored."
      );
    case "DEFERRED_CLIFF":
      return (
        r.detail ??
        "The cliff can only be placed once an event fires, so the schedule can't be stored ahead of time."
      );
  }
};

/*
 * A frozen baseline for upcoming inferrer work.
 *
 * We're about to change what shape the inferrer emits for certain tranche
 * streams. Some streams that look like a single vesting schedule are currently
 * recovered as several overlapping grids, which then evaluate as "events-only"
 * (a flat list of dated amounts) instead of a reusable "template". The plan is to
 * fix that in a few steps.
 *
 * This file pins down where things stand BEFORE any of those changes. For each
 * stream in the corpus it runs the whole round trip a real consumer would — infer
 * a DSL from the tranches, then collapse that program back to one schedule and
 * read its verdict — and snapshots the outcome. Each later step is then reviewed
 * as a diff against this snapshot: the streams we mean to rescue should turn from
 * "events-only" into "template", and the ones that genuinely can't be a single
 * schedule must stay put. Freezing the baseline first is what lets a real rescue
 * and an accidental regression look different in review.
 *
 * Allocation note: the engine has exactly one allocation mode now
 * (CUMULATIVE_ROUND_DOWN), so there's nothing to configure here — the numbers
 * below are simply what `inferSchedule` produces today.
 */

interface CorpusCase {
  id: string;
  /** Plain-English description of what this stream is meant to exercise. */
  witness: string;
  tranches: TrancheInput[];
  /** Total shares across the stream; also the grant quantity for the collapse. */
  grant: number;
  /**
   * Supplied only when a real grant date changes how the stream reads — e.g. a
   * lump a few months in is a cliff if we know the grant date, but ambiguous
   * without one. Omitted otherwise, in which case infer defaults it to the first
   * tranche.
   */
  grantDate?: OCTDate;
}

interface CaseSnapshot {
  dsl: string;
  status: string;
  reason?: string;
  residual: number;
  // One hypothesis-family tag per emitted statement, in program order — the shape
  // recovery took (plain / cliff / fold / then-segment / literal).
  decomposition: HypothesisFamily[];
}

function characterize(c: CorpusCase): CaseSnapshot {
  const inferred = inferSchedule({
    tranches: c.tranches,
    ...(c.grantDate ? { grantDate: c.grantDate } : {}),
  });

  // Read the emitted DSL back through parse + normalize and collapse the whole
  // program into a single schedule. This is the same route the evaluate_program
  // tool takes, so `status` here is the program-level verdict a consumer sees.
  const program = normalizeProgram(parse(inferred.dsl));
  const ctx: ResolutionContextInput = {
    grantDate: c.grantDate ?? c.tranches[0].date,
    events: {},
    grantQuantity: c.grant,
    vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
  };
  const schedule = evaluateProgram(program, ctx);

  // Keep the snapshot at the level we actually reason about: the DSL, the
  // verdict, and how many of each component the decomposition used. The DSL
  // already carries every date and cadence, so there's no need to also pin the
  // full installment vector — when residual is 0 that vector just re-states the
  // input, and it churns the snapshot on harmless rounding reshuffles.
  return {
    dsl: inferred.dsl,
    status: schedule.resolution.status,
    // The resolution reason is structured; render it so the snapshot stays the
    // legible sentence it has always pinned.
    ...(schedule.resolution.status === "events-only"
      ? { reason: renderReason(schedule.resolution.reason) }
      : {}),
    residual: inferred.diagnostics.residualError,
    decomposition: inferred.decomposition.map((c) => c.tag),
  };
}

/**
 * Build `n` monthly tranches of `amount`, starting at `startISO` and keeping its
 * day-of-month. Only used for the plain monthly streams below; the irregular ones
 * are spelled out tranche by tranche so the shape is obvious on the page.
 */
function monthly(startISO: string, n: number, amount: number): TrancheInput[] {
  const [y0, m0, day] = startISO.split("-");
  const out: TrancheInput[] = [];
  for (let i = 0; i < n; i++) {
    const total = Number(m0) + i;
    const y = Number(y0) + Math.floor((total - 1) / 12);
    const m = ((total - 1) % 12) + 1;
    out.push({ date: `${y}-${String(m).padStart(2, "0")}-${day}`, amount });
  }
  return out;
}

const CORPUS: CorpusCase[] = [
  {
    // Monthly on the 1st, but the rate doubles for two months and then drops
    // back. It's really one schedule whose rate changes; today it comes back as
    // two overlapping monthly trains, which can't be a single template.
    id: "C1",
    witness: "monthly grant whose rate doubles mid-stream, then returns",
    tranches: [
      { date: "2023-12-01", amount: 100 },
      { date: "2024-01-01", amount: 100 },
      { date: "2024-02-01", amount: 200 },
      { date: "2024-03-01", amount: 200 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
    ],
    grant: 800,
  },
  {
    // A three-month cliff (the first 300 is three months of 100 vesting at once)
    // followed by a monthly tail. The grant date is two months before the first
    // installment, so the lump reads as a cliff rather than a back-dated start.
    id: "C2",
    witness: "three-month cliff, then a monthly tail",
    tranches: [
      { date: "2024-02-01", amount: 300 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
    ],
    grant: 600,
    grantDate: "2023-11-01",
  },
  {
    // Same cliff head, but the monthly tail steps down to a slower rate partway
    // through. One schedule with a rate change after the cliff.
    id: "C3",
    witness: "cliff, then monthly, then a slower monthly tail",
    tranches: [
      { date: "2024-02-01", amount: 300 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-06-01", amount: 50 },
      { date: "2024-07-01", amount: 50 },
      { date: "2024-08-01", amount: 50 },
    ],
    grant: 750,
    grantDate: "2023-11-01",
  },
  {
    // Cliff and monthly head, then the cadence itself changes — the tail vests
    // quarterly. The handoff from monthly to quarterly lands cleanly on the grid,
    // so this is still a single schedule that just changes cadence.
    //
    // Amounts are picked so every segment's share of the total terminates as a
    // decimal: head 600/800 = 3/4, tail 200/800 = 1/4, and the cliff lump
    // 300/600 = 1/2 of its statement. Percentages store as truncated Numeric
    // strings, so a repeating split (e.g. 2/3 + 1/3) would lose a share and the
    // inferred CLIFF/THEN chain wouldn't round-trip.
    id: "C4",
    witness: "cliff + monthly head, then a quarterly tail",
    tranches: [
      { date: "2024-02-01", amount: 300 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-08-01", amount: 100 },
      { date: "2024-11-01", amount: 100 },
    ],
    grant: 800,
    grantDate: "2023-11-01",
  },
  {
    // Negative control. Two monthly grants on different days of the month (the 1st
    // and the 15th). Their dates interleave and never line up, so this genuinely
    // is two schedules and must never collapse into one.
    id: "C5",
    witness:
      "two monthly grants on different days (1st and 15th) — two schedules",
    tranches: [
      { date: "2024-02-01", amount: 100 },
      { date: "2024-02-15", amount: 50 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-03-15", amount: 50 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-04-15", amount: 50 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-05-15", amount: 50 },
    ],
    grant: 600,
    grantDate: "2024-01-01",
  },
  {
    // Negative control, denser version of C5: three grants on the 1st, 10th, and
    // 20th. One interleaved pair could be a fluke; three makes the point that the
    // dates simply can't be threaded onto one schedule.
    id: "C6",
    witness: "three monthly grants on different days (1st, 10th, 20th)",
    tranches: [
      { date: "2024-02-01", amount: 100 },
      { date: "2024-02-10", amount: 60 },
      { date: "2024-02-20", amount: 30 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-03-10", amount: 60 },
      { date: "2024-03-20", amount: 30 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-04-10", amount: 60 },
      { date: "2024-04-20", amount: 30 },
    ],
    grant: 570,
  },
  {
    // Negative control. This is C1's shape with the last tranche bumped by 5, so
    // no whole-share schedule reproduces it exactly. The inferrer must not "round"
    // it into a template — only streams it can reproduce on the nose get rescued.
    id: "C7",
    witness:
      "almost a clean chain, but the last tranche is off by 5 — no exact fit",
    tranches: [
      { date: "2023-12-01", amount: 100 },
      { date: "2024-01-01", amount: 100 },
      { date: "2024-02-01", amount: 200 },
      { date: "2024-03-01", amount: 200 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 105 },
    ],
    grant: 805,
  },
  {
    // Positive control. A plain six-month monthly grant — unambiguously one
    // template. A future segmenter could in principle chop a flat run like this
    // into a longer chain of equal pieces; this case is here to confirm it keeps
    // emitting the single, shortest form.
    id: "C8",
    witness:
      "a plain six-month monthly grant (one template, not a longer chain)",
    tranches: monthly("2024-02-01", 6, 100),
    grant: 600,
    grantDate: "2024-01-01",
  },
];

describe("inferrer characterization — sequential/THEN baseline", () => {
  for (const c of CORPUS) {
    it(`${c.id}: ${c.witness}`, () => {
      const snap = characterize(c);

      // Hard gate, every case, every phase: the inferrer is lossless. Whatever it
      // emits has to reproduce the input exactly (residual 0). This is the line
      // the negative controls lean on — a stream is only ever turned into a
      // template if it reproduces, never because it was "close enough".
      expect(snap.residual).toBeLessThan(1e-6);

      // The verdict and decomposition live in the snapshot, not in hand-written
      // assertions, so a later phase's effect shows up as a clean diff here.
      expect(snap).toMatchSnapshot();
    });
  }
});
