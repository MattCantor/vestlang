import type { Doc } from "./doc.js";

/**
 * Render a Doc at infinite width: every `line` becomes a space, every
 * `softline` vanishes, every group stays flat. This is the canonical
 * one-line form — `stringify` is exactly `printFlat(toDoc(node))`.
 */
export function printFlat(doc: Doc): string {
  if (typeof doc === "string") return doc;
  if (Array.isArray(doc)) return doc.map(printFlat).join("");
  switch (doc.kind) {
    case "group":
    case "indent":
      return printFlat(doc.contents);
    case "line":
      return " ";
    case "softline":
      return "";
  }
}
