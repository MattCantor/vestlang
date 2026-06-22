// #285: an event id that collides with an `Object.prototype` key (`constructor`,
// `toString`, `valueOf`, `hasOwnProperty`, `__proto__`) is a legal vestlang event
// name, but the evaluator used to read firings as `events[id]` off a plain object.
// An unfired such id read back the inherited prototype member (a function — truthy)
// instead of `undefined`, so the EVENT atom treated it as fired and downstream date
// handling threw (`iso.split is not a function`); on rehydrate, an `in`-based
// membership check matched the inherited key and skipped a bare `constructor`
// firing. The fix null-protos the event maps and reads through `Object.hasOwn`.

import { describe, it, expect } from "vitest";
import type { AsOfContextInput } from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/index.js";
import { rehydrate } from "../src/resolve/index.js";

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const ctx = (over: Partial<AsOfContextInput> = {}): AsOfContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 400,
  asOf: "2030-01-01",
  ...over,
});

// EVENT-anchored start, duration cliff — both verdicts land in `template`.
const schedule = (eventId: string) =>
  `VEST FROM EVENT ${eventId} OVER 4 months EVERY 1 month CLIFF +2 months`;

// The dangerous keys: every truthy `Object.prototype` member a bare id can spell.
// `__proto__`'s value is itself an object (truthy), so it crashed the same way.
const PROTO_KEYS = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
] as const;

describe("#285 — unfired prototype-key event evaluates without crashing", () => {
  it.each(PROTO_KEYS)(
    "reads %s as pending on both verdicts, no throw",
    (key) => {
      const result = evaluateProgram(prog(schedule(key)), ctx());

      // No events supplied, so the firing-blind interchange verdict and the
      // closed-world resolution verdict both stay a storable template — the EVENT
      // atom reads "not fired" rather than the inherited prototype value.
      expect(result.interchange.status).toBe("template");
      expect(result.resolution.status).toBe("template");
      expect(result.resolution.pending).toContainEqual({
        type: "EVENT_NOT_YET_OCCURRED",
        event: key,
      });
    },
  );
});

describe("#285 — a fired prototype-key event resolves end-to-end", () => {
  it("matches a non-colliding baseline (constructor ≡ ipo with the same firing)", () => {
    // `constructor` is setter-free, so a programmatic firing survives to the engine
    // (unlike `__proto__`, whose object-literal firing the prototype setter eats —
    // a caller-side limit, not an engine bug; see #285 Decision 6).
    const fired = ctx({
      events: { constructor: "2025-03-01", toString: "2025-04-01" },
    });
    const result = evaluateProgram(prog(schedule("constructor")), fired);

    // The whole call survives — the interchange verdict is the path that crashed
    // today even when the event was fired, since it resolves events-blind.
    expect(result.interchange.status).toBe("template");
    expect(result.resolution.status).toBe("template");

    // Same firing date on a plain id produces the identical projection.
    const baseline = evaluateProgram(
      prog(schedule("ipo")),
      ctx({ events: { ipo: "2025-03-01" } }),
    );
    expect(result.resolution.installments).toEqual(
      baseline.resolution.installments,
    );
  });
});

describe("#285 — rehydrate re-derives the start for a bare prototype-key event", () => {
  it("fires `constructor` as the contingent start, re-derived from the recipe", () => {
    // A bare `EVENT constructor` start is a single contingent origin, so it stores
    // as a contingent-start template whose `evt:start` recipe is re-resolved on
    // reload. The recipe resolution reads the events map through the same
    // prototype-safe path the EVENT atom uses, so a `constructor` firing is found
    // rather than shadowed by the inherited member.
    const DSL = "VEST FROM EVENT constructor OVER 4 months EVERY 1 month";
    // Reload reads the firing-invariant interchange artifact (firing-free runtime).
    const { interchange } = evaluateProgram(prog(DSL), ctx());
    if (interchange.status !== "template")
      throw new Error(`expected template, got ${interchange.status}`);
    const { template, sourceMap, runtime } = interchange;
    expect(sourceMap["evt:start"].definition).toContain("constructor");

    const result = rehydrate(
      template,
      sourceMap,
      runtime,
      ctx({ events: { constructor: "2025-03-01" } }),
    );

    expect(result.startToApply).toEqual({ date: "2025-03-01" });
    expect(result.runtime.startDate).toBe("2025-03-01");
    expect(result.pending).toEqual([]);
  });

  it("leaves the start pending when the prototype-key event is unfired", () => {
    const DSL = "VEST FROM EVENT constructor OVER 4 months EVERY 1 month";
    const { interchange } = evaluateProgram(prog(DSL), ctx());
    if (interchange.status !== "template")
      throw new Error(`expected template, got ${interchange.status}`);
    const { template, sourceMap, runtime } = interchange;

    const result = rehydrate(template, sourceMap, runtime, ctx());
    expect(result.startToApply).toBeNull();
    expect(result.pending).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "constructor",
    });
  });
});

describe("#285 — named-but-unfired `undefined` event still reads pending", () => {
  it("does not throw and reads the start as pending (Decision 5 regression guard)", () => {
    // The guard must check definedness, not bare own-key presence: a bare
    // `Object.hasOwn(...) ? RESOLVED : UNRESOLVED` would take RESOLVED with an
    // `undefined` date here and reintroduce the `iso.split` crash.
    const run = () =>
      evaluateProgram(
        prog("VEST FROM EVENT ipo OVER 4 months EVERY 1 month"),
        ctx({ events: { ipo: undefined } }),
      );
    expect(run).not.toThrow();
    expect(run().resolution.pending).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
    });
  });
});
