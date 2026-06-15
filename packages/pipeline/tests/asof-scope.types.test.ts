// Type-level guards for scoping the observation date to the operations that
// consume it. The context type is split into a structure-resolution form (no
// observation date) and a point-in-time form that adds one; structure entries
// take the former, the as-of entries the latter. These assertions pin that split
// so a future edit can't quietly put `asOf` back on a structure path.
//
// Validated by `tsc -p tsconfig.lint.json` (the root `typecheck`, which includes
// `tests`); the bodies never execute.

import { describe, it, expectTypeOf } from "vitest";
import type {
  ResolutionContext,
  ResolutionContextInput,
  AsOfContext,
  AsOfContextInput,
} from "@vestlang/types";
import {
  evaluateProgram,
  evaluateStatement,
  evaluateProgramAsOf,
} from "@vestlang/evaluator";
import { buildContext, buildAsOfContext } from "../src/context.js";

describe("the context split exists, both input and resolved (AC#1)", () => {
  it("the resolution forms carry no observation date", () => {
    expectTypeOf<"asOf">().not.toEqualTypeOf<keyof ResolutionContext>();
    expectTypeOf<"asOf">().not.toEqualTypeOf<keyof ResolutionContextInput>();
    expectTypeOf<
      "asOf" extends keyof ResolutionContext ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "asOf" extends keyof ResolutionContextInput ? true : false
    >().toEqualTypeOf<false>();
  });

  it("the as-of forms carry the observation date", () => {
    expectTypeOf<AsOfContext["asOf"]>().not.toBeNever();
    expectTypeOf<AsOfContextInput["asOf"]>().not.toBeNever();
  });

  it("an as-of context IS-A resolution context (the assignability the split rests on)", () => {
    expectTypeOf<AsOfContext>().toMatchTypeOf<ResolutionContext>();
    expectTypeOf<AsOfContextInput>().toMatchTypeOf<ResolutionContextInput>();
  });
});

describe("structure entries reject an asOf literal but accept an as-of value (AC#2)", () => {
  it("the structure entry's context param has no asOf key", () => {
    type ProgramCtx = Parameters<typeof evaluateProgram>[1];
    type StatementCtx = Parameters<typeof evaluateStatement>[1];
    expectTypeOf<"asOf">().not.toEqualTypeOf<keyof ProgramCtx>();
    expectTypeOf<"asOf">().not.toEqualTypeOf<keyof StatementCtx>();
    expectTypeOf<
      "asOf" extends keyof ProgramCtx ? true : false
    >().toEqualTypeOf<false>();
  });

  // These pin compile-time assignability only; the engine is never actually run
  // (the calls sit in a never-invoked function so an empty program can't throw).
  it("a fresh literal carrying asOf is an excess-property error; an as-of VALUE is accepted", () => {
    const _typeOnly = (program: Parameters<typeof evaluateProgram>[0]) => {
      evaluateProgram(program, {
        grantDate: "2025-01-01",
        events: {},
        grantQuantity: 100,
        // @ts-expect-error — `asOf` is an excess property on the structure-entry context.
        asOf: "2026-01-01",
      });

      // The IS-A design: a typed as-of value is assignable to the structure param.
      const asOfCtx: AsOfContextInput = {
        grantDate: "2025-01-01",
        events: {},
        grantQuantity: 100,
        asOf: "2026-01-01",
      };
      evaluateProgram(program, asOfCtx);
    };
    expectTypeOf(_typeOnly).toBeFunction();
  });
});

describe("point-in-time entries require the as-of form (AC#3)", () => {
  it("their context param carries the observation date", () => {
    type ProgramAsOfCtx = Parameters<typeof evaluateProgramAsOf>[1];
    expectTypeOf<ProgramAsOfCtx>().toMatchTypeOf<AsOfContextInput>();
  });

  it("a structure-only context (no asOf) is rejected by an as-of entry", () => {
    // Compile-time only — never invoked, so the engine never runs.
    const _typeOnly = (program: Parameters<typeof evaluateProgramAsOf>[0]) => {
      const structureCtx: ResolutionContextInput = {
        grantDate: "2025-01-01",
        events: {},
        grantQuantity: 100,
      };
      // @ts-expect-error — the as-of entry needs the observation date the resolution form lacks.
      evaluateProgramAsOf(program, structureCtx);
    };
    expectTypeOf(_typeOnly).toBeFunction();
  });
});

describe("the default lives at the query builder, not the resolution builder (AC#4, type-level)", () => {
  it("the resolution builder returns a context with no asOf", () => {
    expectTypeOf<
      ReturnType<typeof buildContext>
    >().toMatchTypeOf<ResolutionContextInput>();
    expectTypeOf<"asOf">().not.toEqualTypeOf<
      keyof ReturnType<typeof buildContext>
    >();
  });

  it("the as-of builder returns a context that carries asOf", () => {
    expectTypeOf<
      ReturnType<typeof buildAsOfContext>
    >().toMatchTypeOf<AsOfContextInput>();
    expectTypeOf<ReturnType<typeof buildAsOfContext>["asOf"]>().not.toBeNever();
  });
});
