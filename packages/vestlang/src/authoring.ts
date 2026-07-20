// Prose → vestlang, for a program that calls an LLM itself. vestlang supplies
// the knowledge (the prompt), the check (parse + lint), the corrective
// re-prompt, and the loop that ties them together. The caller supplies the
// transport — this module never opens a socket and never learns which model it
// is talking to.

import { parse } from "@vestlang/dsl";
import { errorDiagnostics, lintText, type Diagnostic } from "@vestlang/linter";
import { normalizeProgram } from "@vestlang/normalizer";
import type { Program } from "@vestlang/types";
import {
  INDETERMINATE_SENTINEL,
  OUTPUT_CONTRACT,
  VESTLANG_AUTHORING_PROMPT,
} from "./authoring/prompt.js";

export { INDETERMINATE_SENTINEL, VESTLANG_AUTHORING_PROMPT };

export type AuthoringMessage = { role: "user" | "assistant"; content: string };

export type AuthoringRequest = {
  system: string;
  messages: AuthoringMessage[];
};

/** One turn against whatever client you already use. Throw to abort the loop. */
export type Complete = (req: AuthoringRequest) => Promise<string>;

export type ValidationResult =
  | { ok: true; program: Program; warnings: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

/**
 * Parse, normalize, and lint a candidate statement. Never throws — a syntax
 * error comes back as a `syntax-error` diagnostic like any other fault.
 *
 * Only error-severity diagnostics block. Warning and info diagnostics ride along
 * on the success branch as `warnings`, since a statement that trips one is still
 * a statement the caller can store.
 */
export function validateVestlang(dsl: string): ValidationResult {
  // `lintText` is the only path that collects the normalizer's own dedupe
  // diagnostics, so it runs exactly once and its output is the whole picture.
  const { diagnostics } = lintText(dsl);
  const blocking = errorDiagnostics(diagnostics);
  if (blocking.length > 0) return { ok: false, diagnostics: blocking };

  // Nothing blocking survived, so the parse inside `lintText` provably did not
  // throw and this second one cannot either. It is the price of `lintText`
  // returning diagnostics without the program it built.
  return {
    ok: true,
    program: normalizeProgram(parse(dsl)),
    warnings: diagnostics,
  };
}

/** The corrective turn: what the model sent, what was wrong with it, what to do. */
export function formatAuthoringFeedback(
  dsl: string,
  diagnostics: Diagnostic[],
): string {
  return [
    "That is not valid vestlang. You sent:",
    "",
    dsl,
    "",
    "It failed validation:",
    ...diagnostics.map((d) => `- [${d.ruleId}] ${d.message}`),
    "",
    `Send a corrected version of the whole program. ${OUTPUT_CONTRACT}`,
  ].join("\n");
}

export type AuthorOptions = {
  /** The prose to translate — a plan excerpt, a grant footnote, an award summary. */
  context: string;
  complete: Complete;
  /** Total model turns allowed, including the first. Defaults to 3. */
  maxAttempts?: number;
};

export type AuthorResult =
  | { ok: true; dsl: string; program: Program; attempts: number }
  | {
      ok: false;
      reason: "invalid";
      dsl: string;
      diagnostics: Diagnostic[];
      attempts: number;
    }
  | { ok: false; reason: "indeterminate"; attempts: number };

const FIRST_CLOSED_FENCE = /```[^\n]*\n([\s\S]*?)```/;

/**
 * Deliberately not clever. A heuristic extractor — longest run of lines that
 * parses, keyword-prefix filtering — can carve a confident-looking statement out
 * of a model's hedged prose, which is the worst failure this API could have. So
 * unfenced prose wrapped around a statement fails validation and earns a refine
 * turn, and an unterminated fence (what a truncated reply looks like) is not a
 * block at all.
 */
function extractStatement(reply: string): string {
  const trimmed = reply.trim();
  const fenced = FIRST_CLOSED_FENCE.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * Ask a model for the vestlang that expresses `context`, check what comes back,
 * and hand it the fault to fix if it doesn't hold up — up to `maxAttempts`
 * turns, growing one conversation rather than restarting.
 *
 * `ok: true` attests that the statement parses and lints clean. It does **not**
 * attest that the statement means what the prose meant: a schedule with the
 * wrong cadence, cliff, or day-of-month lints perfectly. To check meaning, pass
 * the returned program to `verifyObservations` from `@vestlang/vestlang` along
 * with figures you already know — a disclosed tranche, a year-end balance.
 *
 * Rejects with whatever `complete` rejected with; transport failures are the
 * caller's to handle.
 */
export async function authorVestlang(
  opts: AuthorOptions,
): Promise<AuthorResult> {
  const { context, complete, maxAttempts = 3 } = opts;
  // `< 1` alone would let NaN through into a loop that runs zero times and has
  // no arm of the result union to return.
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      `maxAttempts must be an integer >= 1, received ${String(maxAttempts)}`,
    );
  }

  const messages: AuthoringMessage[] = [
    {
      role: "user",
      content: `Translate this vesting description into vestlang.\n\n${context}`,
    },
  ];

  for (let attempts = 1; ; attempts++) {
    const reply = await complete({
      system: VESTLANG_AUTHORING_PROMPT,
      messages,
    });
    const dsl = extractStatement(reply);

    if (dsl === INDETERMINATE_SENTINEL) {
      return { ok: false, reason: "indeterminate", attempts };
    }

    const validated = validateVestlang(dsl);
    if (validated.ok) {
      return { ok: true, dsl, program: validated.program, attempts };
    }
    if (attempts >= maxAttempts) {
      return {
        ok: false,
        reason: "invalid",
        dsl,
        diagnostics: validated.diagnostics,
        attempts,
      };
    }

    // The assistant turn replays the reply exactly as it arrived, fences and
    // all. When the fault *was* the formatting, that is the thing the model
    // needs to see.
    messages.push({ role: "assistant", content: reply });
    messages.push({
      role: "user",
      content: formatAuthoringFeedback(dsl, validated.diagnostics),
    });
  }
}
