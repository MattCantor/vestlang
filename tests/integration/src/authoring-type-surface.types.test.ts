// Locks the authoring subpath's type surface. The imports are type-only, so
// `pnpm test` runs this green regardless; `pnpm typecheck` is what enforces it.
import { it, expectTypeOf } from "vitest";
import type {
  AuthoringMessage,
  AuthoringRequest,
  Complete,
  ValidationResult,
  AuthorOptions,
  AuthorResult,
} from "@vestlang/vestlang/authoring";

it("exports every type the authoring API is described in", () => {
  expectTypeOf<AuthoringMessage>().not.toBeAny();
  expectTypeOf<AuthoringRequest>().not.toBeAny();
  expectTypeOf<Complete>().not.toBeAny();
  expectTypeOf<ValidationResult>().not.toBeAny();
  expectTypeOf<AuthorOptions>().not.toBeAny();
  expectTypeOf<AuthorResult>().not.toBeAny();
});

// Decision, not accident: the loop verifies well-formedness, never meaning, so
// nothing about a grant's runtime — figures to check against, event firings,
// dates, quantities — belongs in its options.
it("takes no runtime facts about the grant", () => {
  expectTypeOf<AuthorOptions>().not.toHaveProperty("observations");
  expectTypeOf<AuthorOptions>().not.toHaveProperty("events");
  expectTypeOf<AuthorOptions>().not.toHaveProperty("grantDate");
  expectTypeOf<AuthorOptions>().not.toHaveProperty("grantQuantity");
});
