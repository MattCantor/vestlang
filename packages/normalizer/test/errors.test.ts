import { describe, it, expect } from "vitest";
import {
  NormalizerError,
  unexpectedAst,
  unsupportedCompare,
  invariant,
  type NormalizerErrorCode,
} from "../src/errors";

describe("errors.ts", () => {
  it("NormalizerError carries code, message prefix, meta and path", () => {
    const meta = { node: { foo: "bar" } };
    const path = ["expr", "0", "from"];
    const err = new NormalizerError(
      "UNEXPECTED_AST_SHAPE",
      "FromTerm must be Anchor | Qualified | EarlierOf | LaterOf",
      meta,
      path,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NormalizerError);
    expect(err.code).toBe("UNEXPECTED_AST_SHAPE");
    expect(err.message).toMatch(/^\[UNEXPECTED_AST_SHAPE\] /);
    expect(err.meta).toEqual(meta);
    expect(err.path).toEqual(path);
  });

  it("unexpectedAst throws NormalizerError with the correct code", () => {
    expect(() =>
      unexpectedAst("bad tree", { why: "demo" }, ["root", "node"]),
    ).toThrowError(NormalizerError);

    try {
      unexpectedAst("bad tree", { why: "demo" }, ["root", "node"]);
    } catch (e) {
      const err = e as NormalizerError;
      expect(err.code).toBe("UNEXPECTED_AST_SHAPE");
      expect(err.message).toContain("bad tree");
      expect(err.meta).toEqual({ why: "demo" });
      expect(err.path).toEqual(["root", "node"]);
    }
  });

  it("unsupportedCompare throws NormalizerError with the correct code", () => {
    expect(() =>
      unsupportedCompare({ a: 1, b: 2 }, ["temporal", "compare"]),
    ).toThrowError(NormalizerError);

    try {
      unsupportedCompare({ a: 1, b: 2 }, ["temporal", "compare"]);
    } catch (e) {
      const err = e as NormalizerError;
      expect(err.code).toBe("UNSUPPORTED_ANCHOR_COMPARISON");
      expect(err.message).toMatch(
        /Cannot compare anchors at normalization time/i,
      );
      expect(err.meta).toEqual({ a: 1, b: 2 });
      expect(err.path).toEqual(["temporal", "compare"]);
    }
  });

  it("invariant passes when condition is truthy", () => {
    // should not throw
    expect(() => invariant(1 === 1, "should not throw")).not.toThrow();
  });

  it("invariant throws with code INVARIANT when condition is falsy", () => {
    expect(() => invariant(false, "boom", { k: "v" }, ["x", "y"])).toThrowError(
      NormalizerError,
    );

    try {
      invariant(false, "boom", { k: "v" }, ["x", "y"]);
    } catch (e) {
      const err = e as NormalizerError;
      expect(err.code).toBe("INVARIANT" satisfies NormalizerErrorCode);
      expect(err.message).toContain("boom");
      expect(err.meta).toEqual({ k: "v" });
      expect(err.path).toEqual(["x", "y"]);
    }
  });
});
