// A few grammar guards used to fail with a hand-built SyntaxError, which carries
// no source position. They now go through peggy's error(), so the thrown error
// pins where in the input it happened — the same located shape every other parse
// error already has. These tests lock that down: each input must throw, and the
// throw must carry a usable location.

import { describe, it, expect } from "vitest";
import { parse } from "../src/index";

// peggy's location: { source, start: {offset,line,column}, end: {...} }
type ParseError = Error & {
  location?: { start?: { line?: number; column?: number } };
};

const caught = (src: string): ParseError => {
  try {
    parse(src);
  } catch (e) {
    return e as ParseError;
  }
  throw new Error(`expected parse to throw for: ${src}`);
};

describe("converted guards now throw located errors", () => {
  const cases: Array<[label: string, src: string]> = [
    ["denominator of 0", "1/0 VEST OVER 12 months EVERY 1 month"],
    ["a one-item selector", "VEST FROM EARLIER OF (EVENT a)"],
    [
      "vestingStart reserved in FROM",
      "VEST FROM vestingStart OVER 12 months EVERY 1 month",
    ],
    [
      "grantDate reserved in CLIFF",
      "VEST OVER 48 months EVERY 1 month CLIFF grantDate",
    ],
  ];

  for (const [label, src] of cases) {
    it(`${label} → error with a source location`, () => {
      const err = caught(src);
      // still a SyntaxError (peggy's subclasses the built-in), so existing
      // instanceof/message checks elsewhere keep working
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.location).toBeDefined();
      expect(typeof err.location?.start?.line).toBe("number");
      expect(typeof err.location?.start?.column).toBe("number");
    });
  }
});
