// resolveVestingStart resolves a bare anchor expression straight to its date —
// no allocation, no installments, no grant-date fold — and reports a rendered
// reason for any arm that doesn't resolve. These cover both arms of the declared
// ResolvedAnchor contract directly, including a pre-grant date (proving no fold
// runs at this layer either).

import { describe, it, expect } from "vitest";
import type { ResolutionContextInput, VestingNodeExpr } from "@vestlang/types";
import { resolveVestingStart } from "../src/evaluate/resolveVestingStart";
import {
  makeSingletonNode,
  makeVestingBaseDate,
  makeVestingBaseEvent,
} from "./helpers";

const ctxInput = (
  overrides: Partial<ResolutionContextInput> = {},
): ResolutionContextInput => ({
  grantDate: "2025-06-01",
  events: {},
  grantQuantity: 1,
  ...overrides,
});

describe("resolveVestingStart", () => {
  it("resolves a flat DATE to itself", () => {
    const expr = makeSingletonNode(makeVestingBaseDate("2024-03-15"));
    const res = resolveVestingStart(expr, ctxInput());
    expect(res).toEqual({ resolved: true, date: "2024-03-15" });
  });

  // A date strictly before grant_date stays put — the allocation path's grant-date
  // fold never runs here, so resolution at this layer is fold-free too.
  it("resolves a pre-grant DATE without folding it up to grant_date", () => {
    const expr = makeSingletonNode(makeVestingBaseDate("2024-01-01"));
    const res = resolveVestingStart(
      expr,
      ctxInput({ grantDate: "2025-06-01" }),
    );
    expect(res.resolved).toBe(true);
    expect(res.resolved && res.date).toBe("2024-01-01");
    expect(res.resolved && res.date < "2025-06-01").toBe(true);
  });

  it("reports not-resolved with a reason naming the missing event", () => {
    const expr = {
      type: "NODE",
      base: { type: "EVENT", value: "ipo" },
      offsets: [],
    } as VestingNodeExpr;
    const res = resolveVestingStart(expr, ctxInput());
    expect(res.resolved).toBe(false);
    if (!res.resolved) {
      expect(res.blockers.length).toBeGreaterThan(0);
      expect(res.reason).toMatch(/ipo/i);
    }
  });

  // A partial LATER OF — one item resolved (the DATE), one still waiting (the
  // unfired event) — is the one input that comes back PICKED with UNRESOLVED meta,
  // so it exercises the `meta.blockers` branch the other not-resolved cases skip.
  // The LATER OF can't settle to its max while `a` could still fire later, so it
  // stays unresolved and the reason names the held-up event.
  it("reports not-resolved for a partial LATER OF, naming the unfired event", () => {
    const expr: VestingNodeExpr = {
      type: "NODE_LATER_OF",
      items: [
        makeSingletonNode(makeVestingBaseEvent("a")),
        makeSingletonNode(makeVestingBaseDate("2024-01-01")),
      ],
    };
    const res = resolveVestingStart(expr, ctxInput());
    expect(res.resolved).toBe(false);
    if (!res.resolved) {
      expect(res.blockers.length).toBeGreaterThan(0);
      expect(res.reason).toMatch(/EVENT a/);
    }
  });
});
