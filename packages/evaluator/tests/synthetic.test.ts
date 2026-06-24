import { describe, it, expect } from "vitest";
import type { SourceMap, VestingScheduleTemplate } from "@vestlang/types";
import { CONTINGENT_START_SENTINEL } from "@vestlang/utils";
import {
  assertSavePartition,
  classifyStartPartition,
  isSyntheticEventId,
  isSyntheticNamespaceError,
  SyntheticNamespaceError,
} from "../src/resolve/synthetic";
import {
  rehydrate,
  isRehydrateMissingStartMarkerError,
  isRehydrateUnexpectedStartError,
} from "../src/resolve/rehydrate";

// The reserved synthetic-event namespace (`evt:start`, `evt:<digits>`) and the
// tampered-key refusal. Both are the trust boundary for a hand-editable persisted
// artifact, so their accept/reject edges are pinned directly here.

describe("isSyntheticEventId", () => {
  it("accepts the reserved keys: evt:start and evt:<digits>", () => {
    expect(isSyntheticEventId("evt:start")).toBe(true);
    expect(isSyntheticEventId("evt:5")).toBe(true);
    expect(isSyntheticEventId("evt:42")).toBe(true); // multi-digit suffix
  });

  it("rejects keys outside the namespace, anchored end to end", () => {
    expect(isSyntheticEventId("ipo")).toBe(false); // no evt: prefix
    expect(isSyntheticEventId("evt:garbage")).toBe(false); // suffix neither start nor digits
    expect(isSyntheticEventId("evt:x5")).toBe(false); // leading junk — the ^ anchor matters
    expect(isSyntheticEventId("evt:5x")).toBe(false); // trailing junk — the $ anchor matters
  });
});

describe("isSyntheticNamespaceError", () => {
  it("recognizes the tagged error", () => {
    expect(
      isSyntheticNamespaceError(new SyntheticNamespaceError("evt_1")),
    ).toBe(true);
  });

  it("rejects unrelated errors and non-errors (it keys on the name tag)", () => {
    expect(isSyntheticNamespaceError(new Error("evt_1"))).toBe(false);
    expect(isSyntheticNamespaceError("not an error")).toBe(false);
    expect(isSyntheticNamespaceError(undefined)).toBe(false);
  });
});

// The contingent-start biconditional, factored into one classifier (#410). Both the
// save guard (assertSavePartition) and the reload guard (rehydrate) read it, so they
// can't drift on what "consistent" means.
describe("classifyStartPartition", () => {
  const startRecipe: SourceMap = { "evt:start": { definition: "EVENT ipo" } };
  const numberedRecipe: SourceMap = { "evt:1": { definition: "EVENT ipo" } };

  it("returns consistent when both halves are present (contingent start)", () => {
    expect(classifyStartPartition(CONTINGENT_START_SENTINEL, startRecipe)).toBe(
      "consistent",
    );
  });

  it("returns consistent when both halves are absent (plain dated start)", () => {
    expect(classifyStartPartition("2025-01-15", {})).toBe("consistent");
    expect(classifyStartPartition(undefined, {})).toBe("consistent");
  });

  it("returns sentinel-without-recipe for a sentinel start, no evt:start recipe", () => {
    expect(classifyStartPartition(CONTINGENT_START_SENTINEL, {})).toBe(
      "sentinel-without-recipe",
    );
  });

  it("returns recipe-without-sentinel for an evt:start recipe + non-sentinel start", () => {
    // A real date and an undefined start are both "not the sentinel".
    expect(classifyStartPartition("2025-01-15", startRecipe)).toBe(
      "recipe-without-sentinel",
    );
    expect(classifyStartPartition(undefined, startRecipe)).toBe(
      "recipe-without-sentinel",
    );
  });

  it("keys on evt:start only — a numbered evt:<n> beside a real start is consistent", () => {
    // A legacy `evt:<n>` recipe is not the start key, so it does not trip the
    // biconditional: a real start beside it stays loadable.
    expect(classifyStartPartition("2025-01-15", numberedRecipe)).toBe(
      "consistent",
    );
  });
});

// Both guards delegate to the classifier: each non-consistent case throws on save
// AND on reload, mapping the same classification to its own error type (a plain
// Error on save, a tagged refusal on reload).
describe("save + reload both delegate to classifyStartPartition", () => {
  const template = (): VestingScheduleTemplate => ({
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: { occurrences: 4, period: 1, period_type: "MONTHS" },
        percentage: "1",
      },
    ],
  });

  it("sentinel-without-recipe: save throws a plain Error, reload throws the missing-marker refusal", () => {
    const sourceMap: SourceMap = {};
    expect(classifyStartPartition(CONTINGENT_START_SENTINEL, sourceMap)).toBe(
      "sentinel-without-recipe",
    );
    expect(() =>
      assertSavePartition(
        template(),
        { grantDate: "2025-01-01", startDate: CONTINGENT_START_SENTINEL },
        sourceMap,
      ),
    ).toThrow();
    let thrown: unknown;
    try {
      rehydrate(
        template(),
        sourceMap,
        { grantDate: "2025-01-01", startDate: CONTINGENT_START_SENTINEL },
        { grantDate: "2025-01-01", events: {}, grantQuantity: 400 },
      );
    } catch (e) {
      thrown = e;
    }
    expect(isRehydrateMissingStartMarkerError(thrown)).toBe(true);
  });

  it("recipe-without-sentinel: save throws a plain Error, reload throws the unexpected-start refusal", () => {
    const sourceMap: SourceMap = { "evt:start": { definition: "EVENT ipo" } };
    expect(classifyStartPartition("2025-01-15", sourceMap)).toBe(
      "recipe-without-sentinel",
    );
    expect(() =>
      assertSavePartition(
        template(),
        { grantDate: "2025-01-01", startDate: "2025-01-15" },
        sourceMap,
      ),
    ).toThrow();
    let thrown: unknown;
    try {
      rehydrate(
        template(),
        sourceMap,
        { grantDate: "2025-01-01", startDate: "2025-01-15" },
        {
          grantDate: "2025-01-01",
          events: { ipo: "2027-03-01" },
          grantQuantity: 400,
        },
      );
    } catch (e) {
      thrown = e;
    }
    expect(isRehydrateUnexpectedStartError(thrown)).toBe(true);
  });
});
