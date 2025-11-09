/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx,mdx}",
    "./docs/**/*.{md,mdx}",
    "./node_modules/@docusaurus/theme-classic/**/*.js",
  ],
  theme: { extend: {} },
  corePlugins: { preflight: false },
};
