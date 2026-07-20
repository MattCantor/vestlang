// The propose → verify → refine loop, driven entirely by fake `complete`
// functions. Nothing here reaches a network.
import { describe, expect, it } from "vitest";
import {
  authorVestlang,
  INDETERMINATE_SENTINEL,
  VESTLANG_AUTHORING_PROMPT,
  validateVestlang,
  type AuthoringRequest,
  type AuthorResult,
} from "@vestlang/vestlang/authoring";

const VALID = "VEST OVER 48 months EVERY 1 month CLIFF 12 months";
const INVALID = "VEST OVER 10 months EVERY 3 months";

/**
 * A `complete` that replays canned replies in order and snapshots each request.
 * The snapshot matters: the loop appends to one `messages` array across turns,
 * so a captured reference would show the final conversation for every call.
 */
function scripted(replies: string[]) {
  const requests: AuthoringRequest[] = [];
  const complete = (req: AuthoringRequest): Promise<string> => {
    requests.push({
      system: req.system,
      messages: req.messages.map((m) => ({ ...m })),
    });
    const reply = replies[requests.length - 1];
    if (reply === undefined) throw new Error("complete called too many times");
    return Promise.resolve(reply);
  };
  return { complete, requests };
}

/** The blocking messages a candidate produces, as the corrective turn reports them. */
function faultsOf(dsl: string): string[] {
  const result = validateVestlang(dsl);
  if (result.ok) return [];
  return result.diagnostics.map((d) => d.message);
}

/** Narrows to the invalid arm, so a test can read its `dsl` and `diagnostics`. */
function invalidArm(
  result: AuthorResult,
): Extract<AuthorResult, { reason: "invalid" }> {
  if (result.ok || result.reason !== "invalid") {
    expect.unreachable(
      `expected the invalid arm, got ${JSON.stringify(result)}`,
    );
  }
  return result;
}

describe("authorVestlang", () => {
  it("sends the shipped prompt and the caller's prose", async () => {
    const context = "Monthly over four years with a one-year cliff.";
    const { complete, requests } = scripted([VALID]);

    await authorVestlang({ context, complete });

    expect(requests[0].system).toBe(VESTLANG_AUTHORING_PROMPT);
    expect(requests[0].messages).toHaveLength(1);
    expect(requests[0].messages[0].role).toBe("user");
    expect(requests[0].messages[0].content).toContain(context);
  });

  it("returns on the first valid reply", async () => {
    const { complete, requests } = scripted([VALID]);
    const result = await authorVestlang({ context: "…", complete });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dsl).toBe(VALID);
    expect(result.program).toHaveLength(1);
    expect(result.attempts).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it("refines by growing the conversation, not rebuilding the prompt", async () => {
    const firstReply = `\`\`\`vest\n${INVALID}\n\`\`\``;
    const { complete, requests } = scripted([firstReply, VALID]);

    const result = await authorVestlang({ context: "…", complete });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(2);

    const second = requests[1].messages;
    expect(second).toHaveLength(3);
    expect(second[0].role).toBe("user");
    // The model sees its own answer exactly as it wrote it, fences included —
    // the extracted text is for validation, not for the transcript.
    expect(second[1]).toEqual({ role: "assistant", content: firstReply });
    // …and the corrective turn has to name the fault. Echoing the statement back
    // without saying what was wrong with it would satisfy a weaker assertion.
    expect(second[2].role).toBe("user");
    expect(second[2].content).toContain(INVALID);
    for (const message of faultsOf(INVALID)) {
      expect(second[2].content).toContain(message);
    }
  });

  // Omitted, the budget is 3; supplied, it is honoured exactly. Either way the
  // give-up arm carries the last candidate and the faults that sank it.
  it.each([
    ["the default budget", undefined, 3],
    ["a caller-supplied budget", 2, 2],
  ])("gives up after %s", async (_label, maxAttempts, expected) => {
    const { complete, requests } = scripted(
      Array<string>(expected).fill(INVALID),
    );
    const result = invalidArm(
      await authorVestlang({ context: "…", complete, maxAttempts }),
    );

    expect(result.attempts).toBe(expected);
    expect(requests).toHaveLength(expected);
    expect(result.dsl).toBe(INVALID);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // The give-up arm reports what was *validated*, not what arrived. With an
  // unfenced reply the two are identical, so the fences have to be there for the
  // distinction to mean anything.
  it("gives up carrying the extracted statement, not the raw reply", async () => {
    const fencedInvalid = `\`\`\`vest\n${INVALID}\n\`\`\``;
    const { complete } = scripted([fencedInvalid, fencedInvalid]);
    const result = invalidArm(
      await authorVestlang({ context: "…", complete, maxAttempts: 2 }),
    );

    expect(result.dsl).toBe(INVALID);
    expect(result.dsl).not.toContain("`");
  });

  it.each([0, -1, 2.5, NaN])(
    "rejects a maxAttempts of %s before calling the model",
    async (maxAttempts) => {
      let called = false;
      const complete = () => {
        called = true;
        return Promise.resolve(VALID);
      };

      await expect(
        authorVestlang({ context: "…", complete, maxAttempts }),
      ).rejects.toBeInstanceOf(RangeError);
      expect(called).toBe(false);
    },
  );

  it("propagates a transport failure untouched", async () => {
    const boom = new Error("429 from the provider");
    const complete = () => Promise.reject(boom);

    await expect(authorVestlang({ context: "…", complete })).rejects.toBe(boom);
  });
});

describe("the indeterminate outcome", () => {
  it("is taught by the prompt under the same name the loop matches", () => {
    expect(VESTLANG_AUTHORING_PROMPT).toContain(INDETERMINATE_SENTINEL);
  });

  it("returns immediately, spending no further attempts", async () => {
    const { complete, requests } = scripted([INDETERMINATE_SENTINEL, VALID]);
    const result = await authorVestlang({ context: "…", complete });

    expect(result).toEqual({
      ok: false,
      reason: "indeterminate",
      attempts: 1,
    });
    expect(requests).toHaveLength(1);
  });

  it("reports the attempt the sentinel arrived on", async () => {
    const { complete } = scripted([INVALID, INDETERMINATE_SENTINEL]);
    const result = await authorVestlang({ context: "…", complete });

    expect(result).toEqual({
      ok: false,
      reason: "indeterminate",
      attempts: 2,
    });
  });

  it("is not triggered by a reply that merely mentions the sentinel", async () => {
    const hedged = `I would say ${INDETERMINATE_SENTINEL}, but here is a guess.`;
    const { complete } = scripted([hedged, hedged, hedged]);
    const result = await authorVestlang({ context: "…", complete });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
  });
});

describe("extracting the statement from a reply", () => {
  const replyOnce = async (reply: string) => {
    const { complete } = scripted([reply]);
    return authorVestlang({ context: "…", complete, maxAttempts: 1 });
  };

  it.each([
    ["a bare fence", `\`\`\`\n${VALID}\n\`\`\``],
    ["a vest-tagged fence", `\`\`\`vest\n${VALID}\n\`\`\``],
    [
      "a fence surrounded by prose",
      `Here is the schedule:\n\n\`\`\`vest\n${VALID}\n\`\`\`\n\nLet me know if that helps.`,
    ],
  ])("takes the statement out of %s", async (_label, reply) => {
    const result = await replyOnce(reply);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dsl).toBe(VALID);
  });

  // Everything below is a reply the extractor deliberately refuses to rescue —
  // guessing at unfenced prose is how a confident wrong statement gets made.
  it("does not carve a statement out of unfenced prose", async () => {
    const prose = `Here is the schedule: ${VALID}. Let me know if that helps.`;
    const result = invalidArm(await replyOnce(prose));

    // The whole reply goes to the validator untouched — an extractor that
    // returned the statement (or nothing) would land somewhere else entirely.
    expect(result.dsl).toBe(prose);
  });

  it("ignores a triple-backtick that does not open a line", async () => {
    const result = await replyOnce(
      `You can wrap it in \`\`\` if you like. Here it is:\n\n\`\`\`vest\n${VALID}\n\`\`\``,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dsl).toBe(VALID);
  });

  it("treats an unterminated fence as no fence at all", async () => {
    const result = invalidArm(await replyOnce(`\`\`\`vest\n${VALID}`));

    expect(result.dsl).toContain("```vest");
  });

  it.each([
    ["an empty reply", ""],
    ["a whitespace-only reply", "   \n\n  "],
  ])("reports %s as an ordinary syntax error", async (_label, reply) => {
    const result = invalidArm(await replyOnce(reply));

    expect(result.dsl).toBe("");
    expect(result.diagnostics.map((d) => d.ruleId)).toContain("syntax-error");
  });
});
