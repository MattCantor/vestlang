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

// The findings that make a schedule invalid — today only over-allocation, which is
// error severity. We key on severity rather than kind, so any future error-level
// finding blocks a schedule without this needing to enumerate it. (A warning, like
// under-allocation, stays out of the result: leaving shares unvested is legal.)
// Returns the findings themselves, not a flag, so a caller can name what tripped it.
export const errorFindings = (findings: Finding[]): Finding[] =>
  findings.filter((f) => f.severity === "error");

// The complement of errorFindings — the advisory findings a storable schedule
// still carries (an under-allocation, a residual cliff-precision note). Persist
// surfaces these in its success envelope rather than dropping them, so the caller
// sees the warning the error gate let through. One severity split, two readings.
export const warningFindings = (findings: Finding[]): Finding[] =>
  findings.filter((f) => f.severity !== "error");

export const formatFinding = (f: Finding): string => {
  switch (f.kind) {
    case "over-allocation":
      return `over-allocates the grant to ${formatPct(f.sum)} (${fmt(f.sum)}) — not a valid schedule`;
    case "under-allocation":
      return `allocates only ${formatPct(f.sum)} (${fmt(f.sum)}) of the grant`;
    case "precision-insufficient": {
      // The stored decimal can't write the intended fraction precisely enough to
      // allocate to the right whole-share count at this grant size. Name the
      // fraction we inferred and, when one exists, the shorter decimal that lands
      // it; the recommended decimal is absent only when even ten places can't.
      const meant = `${fmt(f.inferred)} (${formatPct(f.inferred)})`;
      const fix = f.recommended
        ? `; store \`${f.recommended}\` to allocate it correctly`
        : ` and no ≤10-place decimal allocates it correctly`;
      return `stored percentage \`${f.percentage}\` is too imprecise for ${f.shareCount} shares — it reads as ${meant}${fix}`;
    }
  }
};
