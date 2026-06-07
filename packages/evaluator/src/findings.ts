import type { Finding, Fraction } from "@vestlang/types";

// A Finding stores the over/under-allocation as an exact fraction (e.g. 3/2), not
// as prose — so a programmatic consumer reads the number directly. This is the one
// place that turns that fraction into something a person reads. Each surface (the
// CLI, the MCP output, the docs Playground) calls this rather than inventing its
// own wording.

// "3/2"
const fmt = (f: Fraction): string => `${f.numerator}/${f.denominator}`;

// "150%" — rounded; the exact fraction is still available via fmt for anyone who
// needs it.
const pct = (f: Fraction): string =>
  `${Math.round((f.numerator / f.denominator) * 100)}%`;

export const formatFinding = (f: Finding): string => {
  switch (f.kind) {
    case "over-allocation":
      return `over-allocates the grant to ${pct(f.sum)} (${fmt(f.sum)}) — not a valid schedule`;
    case "under-allocation":
      return `allocates only ${pct(f.sum)} (${fmt(f.sum)}) of the grant`;
  }
};
