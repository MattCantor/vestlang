import { describe, expect, it } from "vitest";
import type { OCTDate } from "@vestlang/types";
import { CADENCE_CANDIDATES, estimateCadences } from "../src/cadence.js";

function d(s: string): OCTDate {
  return s as unknown as OCTDate;
}
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, day: number): OCTDate =>
  d(`${y}-${pad(m)}-${pad(day)}`);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `n` dates starting at (startY, startM) stepping `step` calendar months. */
function everyNMonths(
  startY: number,
  startM: number,
  step: number,
  n: number,
  day = 1,
): OCTDate[] {
  const out: OCTDate[] = [];
  let y = startY;
  let m = startM;
  for (let i = 0; i < n; i++) {
    out.push(iso(y, m, day));
    m += step;
    while (m > 12) {
      m -= 12;
      y++;
    }
  }
  return out;
}

/** `n` dates starting at `startISO` stepping `step` days. */
function everyNDays(startISO: string, step: number, n: number): OCTDate[] {
  const base = new Date(`${startISO}T00:00:00Z`).getTime();
  const out: OCTDate[] = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(base + i * step * 86_400_000);
    out.push(iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
  }
  return out;
}

/** `n` consecutive month-end dates (stresses the day-of-month convention). */
function monthlyLastDay(startY: number, startM: number, n: number): OCTDate[] {
  const out: OCTDate[] = [];
  let y = startY;
  let m = startM;
  for (let i = 0; i < n; i++) {
    out.push(iso(y, m, lastDay(y, m)));
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

describe("estimateCadences — data-derived period", () => {
  it("every-2-month → 2 months is the top candidate (out of vocabulary)", () => {
    const top = estimateCadences(everyNMonths(2024, 1, 2, 12))[0];
    expect(top).toEqual({ unit: "MONTHS", length: 2 });
  });

  it("every-5-month → 5 months is the top candidate (out of vocabulary)", () => {
    const top = estimateCadences(everyNMonths(2024, 1, 5, 10))[0];
    expect(top).toEqual({ unit: "MONTHS", length: 5 });
  });

  it("annual (3 gaps) → 12 months is the top candidate", () => {
    const top = estimateCadences(everyNMonths(2024, 1, 12, 4))[0];
    expect(top).toEqual({ unit: "MONTHS", length: 12 });
  });

  it("month-end dates → 1 month wins despite day-of-month jitter", () => {
    // Days wobble 28/29/30/31; month-index gaps are a flat 1.
    const top = estimateCadences(monthlyLastDay(2025, 1, 12))[0];
    expect(top).toEqual({ unit: "MONTHS", length: 1 });
  });
});

describe("estimateCadences — regime selection", () => {
  it("biweekly → 14 days wins (day lattice), not a month cadence", () => {
    const top = estimateCadences(everyNDays("2024-01-01", 14, 26))[0];
    expect(top).toEqual({ unit: "DAYS", length: 14 });
  });
});

describe("estimateCadences — superposition", () => {
  it("quarterly year 1 + monthly year 2 → proposes both 1 and 3 months", () => {
    const dates: OCTDate[] = [
      iso(2024, 4, 1),
      iso(2024, 7, 1),
      iso(2024, 10, 1),
      iso(2025, 1, 1),
      ...everyNMonths(2025, 2, 1, 12),
    ];
    const result = estimateCadences(dates);
    expect(result).toContainEqual({ unit: "MONTHS", length: 1 });
    expect(result).toContainEqual({ unit: "MONTHS", length: 3 });
  });
});

describe("estimateCadences — fallback to priors", () => {
  it("irregular dates (no repeated gap) → no data-derived cadence, priors only", () => {
    const dates = [d("2024-03-12"), d("2024-08-07"), d("2025-11-22")];
    const result = estimateCadences(dates);
    // The raw gaps are 5 and 15 months, but with count < 2 neither is trusted,
    // so the result is exactly the curated priors — and never the spurious
    // 5- or 15-month cadence that would merge unrelated one-offs.
    expect(result).toHaveLength(CADENCE_CANDIDATES.length);
    expect(result.some((c) => c.length === 5 || c.length === 15)).toBe(false);
  });

  it("fewer than 2 dates → returns the curated candidate list unchanged", () => {
    expect(estimateCadences([d("2025-06-15")])).toEqual([...CADENCE_CANDIDATES]);
    expect(estimateCadences([])).toEqual([...CADENCE_CANDIDATES]);
  });
});
