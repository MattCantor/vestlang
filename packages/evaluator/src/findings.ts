import type { Finding, Fraction } from "@vestlang/types";
import { formatPct } from "@vestlang/utils";

// A Finding stores the over/under-allocation as an exact fraction (e.g. 3/2), not
// as prose — so a programmatic consumer reads the number directly. This is the one
// place that turns that fraction into something a person reads. Each surface (the
// CLI, the MCP output, the docs Playground) calls this rather than inventing its
// own wording. The percent uses @vestlang/utils' formatPct, shared with the linter
// so the two never word the same number differently.

// "3/2"
const fmt = (f: Fraction): string => `${f.numerator}/${f.denominator}`;

export const formatFinding = (f: Finding): string => {
  switch (f.kind) {
    case "over-allocation":
      return `over-allocates the grant to ${formatPct(f.sum)} (${fmt(f.sum)}) — not a valid schedule`;
    case "under-allocation":
      return `allocates only ${formatPct(f.sum)} (${fmt(f.sum)}) of the grant`;
  }
};
