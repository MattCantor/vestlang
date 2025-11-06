import type { SupportLanguage } from "prettier";

export const languages: SupportLanguage[] = [
  {
    name: "Vestlang",
    parsers: ["vestlang-parser"],
    aliases: ["vest", "vestlang"],
    extensions: [".vest"],
    tmScope: "source.vestlang",
    aceMode: "text",
    vscodeLanguageIds: ["vestlang"],
  },
];
