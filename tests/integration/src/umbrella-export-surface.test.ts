// Guards the shipped public surface of `@vestlang/vestlang` against the *built*
// barrel — the exact artifact consumers import. The value half lives here (a
// runtime test sees only values); the erased type half is locked separately in
// umbrella-type-surface.ts, which `pnpm typecheck` compiles. Sound only after a
// build, which is how CI runs (build before test).
import { describe, expect, expectTypeOf, it } from "vitest";
import * as umbrella from "@vestlang/vestlang";
import type { UmbrellaTypeSurface } from "./umbrella-type-surface.js";

// The curated value exports. `core` is a namespace object; the rest are functions.
const EXPECTED_FUNCTIONS = [
  "parse",
  "normalizeProgram",
  "presentSchedule",
  "evaluateProgramWithRecovery",
  "lintProgram",
  "lintText",
  "stringify",
  "stringifyProgram",
  "stringifyStatement",
  "inferSchedule",
] as const;

describe("umbrella export surface", () => {
  it("exposes every curated value export", () => {
    for (const name of EXPECTED_FUNCTIONS) {
      expect(typeof umbrella[name], name).toBe("function");
    }
  });

  it("re-exports the core compiler as a namespace", () => {
    expect(typeof umbrella.core).toBe("object");
    expect(typeof umbrella.core.compile).toBe("function");
  });

  it("no longer exposes a primitives namespace", () => {
    expect("primitives" in umbrella).toBe(false);
  });

  // The re-exported type surface is enforced at compile time (see
  // umbrella-type-surface.ts); this keeps that manifest referenced.
  it("keeps its re-exported type surface", () => {
    expectTypeOf<UmbrellaTypeSurface>().not.toBeNever();
  });
});
