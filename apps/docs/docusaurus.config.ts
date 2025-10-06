import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "vestlang",
  tagline: "A DSL for vesting schedules",
  favicon: "img/vestlang-icon.png",

  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: "https://MattCantor.github.io",
  baseUrl: "/vestlang/",

  // GitHub pages deployment config.
  organizationName: "MattCantor",
  projectName: "vestlang",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  trailingSlash: false,

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/MattCantor/vestlang/",
          routeBasePath: "/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
        pages: false,
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/vestlang-icon.png",
    navbar: {
      title: "vestlang",
      logo: {
        alt: "vestlang logo",
        src: "img/vestlang-icon.png",
        srcDark: "img/vestlang-icon.png",
      },
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json", "typescript"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
