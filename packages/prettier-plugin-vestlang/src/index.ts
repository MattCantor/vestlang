import type { Plugin } from "prettier";
import { languages } from "./language.js";
import { parser } from "./parser.js";
import printer from "./printer.js";

const plugin: Plugin = {
  languages,
  parsers: {
    "vestlang-parser": parser,
  },
  printers: {
    "vestlang-ast": printer,
  },
};

export default plugin;
