import { describe, it, expect } from "vitest";
import {
  isSyntheticEventId,
  isSyntheticNamespaceError,
  SyntheticNamespaceError,
} from "../src/resolve/synthetic";

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
