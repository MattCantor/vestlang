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
    const UNITS = /\b(?:YEAR|YEARS|MONTH|MONTHS|WEEK|WEEKS|DAY|DAYS)\b/i;
    const KEYWORDS =
      /\b(?:VEST|SCHEDULE|FROM|OVER|EVERY|EARLIER|LATER|OF|BEFORE|AFTER|EVENT|DATE|STRICTLY|AND)\b/i;

    Prism.languages.vest = {
      duration: {
        pattern: RegExp(String.raw`\b\d+\s+` + UNITS.source),
        inside: {
          number: /\b\d+\b/,
          unit: { pattern: UNITS, alias: "builtin" },
        },
        alias: "type",
      },

      // Dates YYYY-MM-DD
      date: { pattern: /\b\d{4}-\d{2}\b/, alias: "constant" },

      // Numbers (including decimals)
      number: { pattern: /\b\d+(?:\.\d+)?\b/, alias: "number" },

      // Keywords (case-insensitive)
      keyword: KEYWORDS,

      // Punctuation
      punctuation: /[(),]/,

      // Identifiers / event names (fallback)
      variable: /\b[A-Za-z_][\w-]*\b/,
    };
  }

  // Clean up and eventually restore former globalThis.Prism object (if any)
  delete (globalThis as Optional<typeof globalThis, "Prism">).Prism;
  if (typeof PrismBefore !== "undefined") {
    globalThis.Prism = PrismObject;
  }
}
