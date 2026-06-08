// Exhaustiveness guard for discriminated-union switches across the repo. Used as
// `default: return assertNever(x)` — it only compiles while every union member is
// handled, so adding a variant breaks the build at the switch that forgot it
// rather than letting the new case fall through silently. The throw is the
// runtime backstop for values that arrive via a cast or untyped input.
export function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
