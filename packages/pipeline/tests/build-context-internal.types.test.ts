// AC#3 — `buildContext` stays internal to the pipeline (Option B): the run* entries
// call it, but it is NOT re-exported from the package index, so an app can't
// hand-assemble a context and skip a defaulted field.
//
// This is a type-level guard, validated by `tsc -p tsconfig.lint.json` (the root
// `typecheck`, which includes `tests`). A `keyof` over the package's public module
// type must not contain `buildContext`; a stray re-export would make this fail to
// compile. A runtime `toBeUndefined` check wouldn't suffice — a typo'd re-export
// could still read as undefined at runtime. The body never executes.

import { describe, it, expectTypeOf } from "vitest";
import type * as PublicApi from "../src/index.js";

describe("buildContext stays internal (AC#3)", () => {
  it("is not a member of the pipeline's public export surface", () => {
    expectTypeOf<keyof typeof PublicApi>().not.toEqualTypeOf<"buildContext">();
    expectTypeOf<
      "buildContext" extends keyof typeof PublicApi ? true : false
    >().toEqualTypeOf<false>();
  });
});
