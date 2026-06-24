// R2-T1, pipeline half — conservation is only as good as the surface a
// consumer reads. Each row asserts the as-of partition, the summary roll-up,
// and the evaluate view agree on one total, and that total is the
// hand-computed claim.
//
// `total_impossible` is its own bucket — impossible shares don't sit inside
// `total_unvested`, so the conserved total adds vested, unvested, and impossible.

import { describe, it, expect } from "vitest";
import { runAsOf, runEvaluate } from "../src/index";

const AS_OF = "2026-01-01";

const sumInstallments = (xs: { amount: number }[]) =>
  xs.reduce((a, x) => a + x.amount, 0);

interface Row {
  name: string;
  dsl: string;
  grantQuantity: number;
  events?: Record<string, string>;
  // The conserved program total, and the slices of it as of 2026-01-01.
  vested: number;
  unresolved: number;
  impossible: number;
}

const ROWS: Row[] = [
  {
    name: "three pending thirds",
    dsl:
      "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
      "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
      "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
    grantQuantity: 100,
    vested: 0,
    unresolved: 100,
    impossible: 0,
  },
  {
    name: "thirds all fired",
    dsl:
      "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
      "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
      "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month",
    grantQuantity: 100,
    events: { a: "2024-03-10", b: "2024-03-10", c: "2024-03-10" },
    vested: 100,
    unresolved: 0,
    impossible: 0,
  },
  {
    name: "mixed dated + pending",
    dsl:
      "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
      "PLUS 2/3 VEST OVER 2 months EVERY 1 month",
    grantQuantity: 100,
    vested: 66,
    unresolved: 34,
    impossible: 0,
  },
  {
    name: "THEN chain, pending head",
    dsl:
      "1/3 VEST FROM EVENT ipo OVER 1 month EVERY 1 month " +
      "THEN 2/3 VEST OVER 1 month EVERY 1 month",
    grantQuantity: 100,
    vested: 0,
    unresolved: 100,
    impossible: 0,
  },
  {
    name: "events arm with pending sibling",
    dsl:
      "1/2 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month " +
      "PLUS 1/4 VEST FROM DATE 2024-06-15 OVER 2 months EVERY 1 month " +
      "PLUS 1/4 VEST FROM EVENT ipo OVER 2 months EVERY 1 month",
    grantQuantity: 4800,
    vested: 3600,
    unresolved: 1200,
    impossible: 0,
  },
  {
    name: "void + live mix",
    dsl:
      "2/3 VEST FROM EVENT a BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month " +
      "PLUS 2/3 VEST FROM EVENT b OVER 1 month EVERY 1 month",
    grantQuantity: 100,
    events: { a: "2025-06-01" },
    vested: 0,
    unresolved: 66,
    impossible: 34,
  },
  {
    name: "two full-grant quantities",
    dsl:
      "100 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
      "PLUS 100 VEST FROM EVENT b OVER 1 month EVERY 1 month",
    grantQuantity: 100,
    vested: 0,
    unresolved: 100,
    impossible: 0,
  },
  {
    name: "dated over-allocation, uncapped",
    dsl:
      "3/4 VEST OVER 1 month EVERY 1 month " +
      "PLUS 3/4 VEST FROM DATE 2024-06-15 OVER 1 month EVERY 1 month",
    grantQuantity: 100,
    vested: 150,
    unresolved: 0,
    impossible: 0,
  },
];

describe("conservation — pipeline cross-surface agreement (R2-T1)", () => {
  for (const row of ROWS) {
    it(`${row.name}: partition, summary, and view agree on one conserved total`, () => {
      const grant = {
        grant_date: "2024-01-01",
        grant_quantity: row.grantQuantity,
        events: row.events ?? {},
      };
      const r = runAsOf(row.dsl, grant, AS_OF);
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // The pinned partition.
      expect(sumInstallments(r.vested)).toBe(row.vested);
      expect(r.unresolved).toBe(row.unresolved);
      expect(sumInstallments(r.impossible)).toBe(row.impossible);

      // Summary mirrors the partition, term for term.
      expect(r.summary.total_vested).toBe(sumInstallments(r.vested));
      expect(r.summary.total_unvested).toBe(
        sumInstallments(r.unvested) + r.unresolved,
      );
      expect(r.summary.total_impossible).toBe(sumInstallments(r.impossible));

      // The evaluate view (recovery included) carries the same total — every
      // installment lands in one of the three roll-up buckets.
      const e = runEvaluate(row.dsl, grant);
      expect(e.ok).toBe(true);
      if (!e.ok) return;
      expect(sumInstallments(e.view.installments)).toBe(
        r.summary.total_vested +
          r.summary.total_unvested +
          r.summary.total_impossible,
      );
    });
  }
});
