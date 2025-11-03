import siteConfig from "@generated/docusaurus.config";
import type * as PrismNamespace from "prismjs";
import type { Optional } from "utility-types";

export default function prismIncludeLanguages(
  PrismObject: typeof PrismNamespace,
): void {
  const {
    themeConfig: { prism },
  } = siteConfig;
  const { additionalLanguages } = prism as { additionalLanguages: string[] };

  const PrismBefore = globalThis.Prism;
  globalThis.Prism = PrismObject;

  additionalLanguages.forEach((lang) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(`prismjs/components/prism-${lang}`);
  });

  // --- Register custom VEST language (SSR + client) ----
  const Prism = PrismObject;

  if (!Prism.languages.vest) {
    const DURATION = /\b(?:YEAR|YEARS|MONTH|MONTHS|WEEK|WEEKS|DAY|DAYS)\b/i;

    const VERBS = /\b(?:VEST|FROM|OVER|EVERY|CLIFF)\b/i;
    const SELECTORS = /\b(?:EARLIER|LATER|OF)\b/i;
    const CONSTRAINTS = /\b(?:BEFORE|AFTER|STRICTLY|AND|OR)\b/i;
    const ANCHORS = /\b(?:EVENT|DATE)\b/i;

    Prism.languages.vest = {
      verb: { pattern: VERBS },
      selector: { pattern: SELECTORS },
      constraint: { pattern: CONSTRAINTS },
      anchor: { pattern: ANCHORS },
      duration: { pattern: DURATION },

      // Dates YYYY-MM-DD
      date: { pattern: /\b\d{4}-\d{2}\b/ },

      // Numbers (including decimals)
      number: { pattern: /\b\d+(?:\.\d+)?\b/ },

      // Identifiers (event names, etc)
      ident: { pattern: /b\[A-Za-z_][A-Za-z0-9_-]*\b/ },

      // Punctuation
      punctuation: /[(),]/,
    };
  }

  // Clean up and eventually restore former globalThis.Prism object (if any)
  delete (globalThis as Optional<typeof globalThis, "Prism">).Prism;
  if (typeof PrismBefore !== "undefined") {
    globalThis.Prism = PrismObject;
  }
}
