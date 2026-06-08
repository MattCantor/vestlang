/**
 * Thrown when the inferrer is handed input that violates its contract — empty
 * tranches, or amounts that aren't non-negative integers. Distinct from the
 * "no clean fit" outcome, and from any error that bubbles up from a deeper
 * layer, so callers can surface input mistakes as clean domain errors instead
 * of leaking engine internals.
 */
export class InferInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferInputError";
  }
}
