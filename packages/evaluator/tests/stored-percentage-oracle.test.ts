import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { compile } from "@vestlang/core";
import { addPeriod } from "@vestlang/primitives";
import type { OCTDate } from "@vestlang/types";
import { resolveToCore } from "../src/resolve/index";

// Does storing a schedule as ten-place decimals still project what the exact
// rationals project? This asks it directly, over an enumerated set of share splits,
// against a reference projector written here rather than borrowed from the engine.
//
// The reference is deliberately independent of both storage arms. It is not the
// events arm — that reads the stored cliff decimal back, so comparing the two arms
// would be partly comparing a value to itself, for exactly the cliff schedules this
// is about. It is not a frozen table of numbers either: those are built from the
// stored values and would simply move with them.
//
// What it shares with the engine is only the calendar (`addPeriod`) and the
// allocation rule — one running cumulative over the date-sorted event stream, each
// tranche the floor of that cumulative minus what has vested. Every fraction it
// carries is exact.
//
// The equality holds up to a grant, and the bound is derived from the run rather
// than written down: the floors part company once the accumulated round-up times
// the grant reaches 1/D, where D is the denominator of the running CUMULATIVE — an
// lcm across the prefix, not any single statement's denominator (1/3 and 1/4 have a
// cumulative of 7/12) — and a cliff composes a second round-up on top of the
// statement's, hence the factor of two. So the projector reports the largest
// cumulative denominator it saw and the grants are checked against that.

type Frac = { n: bigint; d: bigint };

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x || 1n;
};
const frac = (n: bigint, d: bigint): Frac => {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const add = (a: Frac, b: Frac): Frac => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);

interface StmtSpec {
  share: Frac;
  /** OVER, in months. */
  months: number;
  /** EVERY, in months. */
  every: number;
  /** CLIFF, in months; absent for no cliff. */
  cliff?: number;
}

interface Fixture {
  name: string;
  stmts: StmtSpec[];
  /** True when the shares sum to exactly 1. */
  whole: boolean;
}

const START: OCTDate = "2020-01-01";
// The grant date is the start, so no tranche ever lands before the grant and the
// engine's pre-grant fold is the identity here.
const GRANT_DATE: OCTDate = START;

const dsl = (f: Fixture): string =>
  f.stmts
    .map((s, i) => {
      const amount =
        f.stmts.length === 1 && s.share.n === s.share.d
          ? ""
          : `${s.share.n}/${s.share.d} `;
      const head =
        i === 0 ? `${amount}VEST FROM DATE ${START}` : `${amount}VEST`;
      const cliff = s.cliff === undefined ? "" : ` CLIFF ${s.cliff} months`;
      return `${head} OVER ${s.months} months EVERY ${s.every} months${cliff}`;
    })
    .join(" THEN ");

interface Tranche {
  date: OCTDate;
  amount: bigint;
}

/** The exact-rational projection, plus the largest cumulative denominator it had
 *  to hold along the way (the grant bound is read off that). */
const exactProjection = (
  f: Fixture,
  grant: bigint,
): { tranches: Tranche[]; maxCumulativeDenominator: bigint } => {
  type Ev = {
    date: OCTDate;
    fraction: Frac;
    order: number;
    occurrence: number;
  };
  const events: Ev[] = [];

  let anchor = START;
  f.stmts.forEach((s, index) => {
    const order = index + 1;
    const occurrences = s.months / s.every;
    const at = (i: number): OCTDate => addPeriod(anchor, i * s.every, "MONTHS");
    const grid = Array.from({ length: occurrences }, (_, i) => i + 1);

    if (s.cliff === undefined) {
      const per = mul(s.share, frac(1n, BigInt(occurrences)));
      for (const i of grid)
        events.push({ date: at(i), fraction: per, order, occurrence: i });
    } else {
      const cliffDate = addPeriod(anchor, s.cliff, "MONTHS");
      const pre = grid.filter((i) => at(i) <= cliffDate);
      const post = grid.filter((i) => at(i) > cliffDate);
      const pct = frac(BigInt(pre.length), BigInt(occurrences));
      // The lump sorts ahead of anything else on its day (occurrence 0).
      events.push({
        date: cliffDate,
        fraction: mul(s.share, pct),
        order,
        occurrence: 0,
      });
      if (post.length > 0) {
        const per = mul(
          s.share,
          mul(sub(frac(1n, 1n), pct), frac(1n, BigInt(post.length))),
        );
        for (const i of post)
          events.push({ date: at(i), fraction: per, order, occurrence: i });
      }
    }
    // The next statement in the chain picks up where this grid ended.
    anchor = addPeriod(anchor, s.months, "MONTHS");
  });

  events.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      a.order - b.order ||
      a.occurrence - b.occurrence,
  );

  let cumulative: Frac = { n: 0n, d: 1n };
  let vested = 0n;
  let maxCumulativeDenominator = 1n;
  const tranches: Tranche[] = [];
  for (const e of events) {
    cumulative = add(cumulative, e.fraction);
    if (cumulative.d > maxCumulativeDenominator)
      maxCumulativeDenominator = cumulative.d;
    const amount = (cumulative.n * grant) / cumulative.d - vested;
    if (amount === 0n) continue;
    vested += amount;
    tranches.push({ date: e.date, amount });
  }
  return { tranches, maxCumulativeDenominator };
};

const storedProjection = (f: Fixture, grant: number): Tranche[] => {
  const result = resolveToCore(normalizeProgram(parse(dsl(f))), {
    grantDate: GRANT_DATE,
    events: {},
    grantQuantity: grant,
  });
  if (result.kind !== "template") throw new Error(`${f.name}: not a template`);
  return compile(result.template, result.totalShares, result.runtime).map(
    (e) => ({ date: e.date, amount: BigInt(e.amount) }),
  );
};

const third = frac(1n, 3n);
const FIXTURES: Fixture[] = [
  // A cliff that is a third of its grid — the schedule shape the whole change is
  // about, and a cliff fraction with no exact decimal.
  {
    name: "annual grid, one-third cliff",
    stmts: [{ share: frac(1n, 1n), months: 36, every: 12, cliff: 12 }],
    whole: true,
  },
  // A cliff at 19/48 of a monthly grid — the other non-terminating cliff shape.
  {
    name: "monthly grid, 19-month cliff",
    stmts: [{ share: frac(1n, 1n), months: 48, every: 1, cliff: 19 }],
    whole: true,
  },
  // Three statements, none of which has an exact decimal.
  {
    name: "three thirds in a chain",
    stmts: [
      { share: third, months: 3, every: 1 },
      { share: third, months: 3, every: 1 },
      { share: third, months: 3, every: 1 },
    ],
    whole: true,
  },
  // Two statements whose cumulative denominator (48) is larger than either share's.
  {
    name: "19/48 then 29/48",
    stmts: [
      { share: frac(19n, 48n), months: 19, every: 1 },
      { share: frac(29n, 48n), months: 29, every: 1 },
    ],
    whole: true,
  },
  // A cumulative denominator neither statement carries: 1/3 + 1/4 = 7/12.
  {
    name: "a third then a quarter",
    stmts: [
      { share: third, months: 3, every: 1 },
      { share: frac(1n, 4n), months: 4, every: 1 },
    ],
    whole: false,
  },
  // A cliff sitting on a non-terminating statement share: two round-ups composed.
  {
    name: "sixths, the tail on a two-thirds cliff",
    stmts: [
      { share: frac(1n, 6n), months: 6, every: 1 },
      { share: frac(5n, 6n), months: 12, every: 2, cliff: 8 },
    ],
    whole: true,
  },
];

const GRANTS = [97, 1005, 30000, 48000, 100000, 1000000, 10000000];

// Every reference projection, built once here rather than inside the cases. The
// bound below has to see the whole fixture set: derived from an array the cases
// fill as they run, a filtered or shuffled run would check the grant range against
// whichever denominators happened to be collected and pass on one it never saw —
// which is the failure this bound exists to catch.
const REFERENCE = new Map<string, ReturnType<typeof exactProjection>>(
  FIXTURES.flatMap((f) =>
    GRANTS.map((grant): [string, ReturnType<typeof exactProjection>] => [
      `${f.name} @ ${grant}`,
      exactProjection(f, BigInt(grant)),
    ]),
  ),
);

const WORST_DENOMINATOR = [...REFERENCE.values()].reduce(
  (worst, r) =>
    r.maxCumulativeDenominator > worst ? r.maxCumulativeDenominator : worst,
  1n,
);

describe("stored decimals project what the exact fractions project", () => {
  it.each(FIXTURES)("$name", (f) => {
    for (const grant of GRANTS) {
      const key = `${f.name} @ ${grant}`;
      const reference = REFERENCE.get(key);
      if (!reference) throw new Error(`no reference projection for ${key}`);
      expect(storedProjection(f, grant), key).toEqual(reference.tranches);
      const total = reference.tranches.reduce((s, t) => s + t.amount, 0n);
      if (f.whole) expect(total).toBe(BigInt(grant));
    }
  });

  it("every grant tested sits inside the bound the run itself derived", () => {
    const bound = 10n ** 10n / (2n * WORST_DENOMINATOR);
    expect(BigInt(Math.max(...GRANTS))).toBeLessThanOrEqual(bound);
  });
});
