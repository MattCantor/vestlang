# Talk: Vesting Schedules as Radio Astronomy

reveal-md deck for the OCTC Summit. Design/beat sheet lives in
`../vestlang-talk-arc.md`; this folder is the deck itself.

## Files

- `slides.md` — the deck (reveal-md markdown, `moon` theme).
- `assets/talk.css` — styling on top of the moon theme.
- `assets/talk.js` — animation runtime. Currently renders labeled placeholders
  for the three hero animations (A1/A2/A3); real animations get registered in
  the `ANIMATIONS` map in a later pass.

## Preview (day-to-day)

From the repo root:

```sh
npx reveal-md docs/talk/slides.md --port 1948
```

`--watch` is on by default — edits to `slides.md` live-reload. Press `S` for
speaker view (the beat notes live in `Note:` blocks). `--print deck.pdf` exports
a PDF.

## Static export (for hosting)

Run from **inside this directory** (reveal-md resolves the `css:`/`scripts:`
front-matter paths relative to the current dir, so running from the repo root
fails to find `assets/`):

```sh
cd docs/talk
npx reveal-md slides.md --static _site
```

To publish on the vestlang site, export into the Docusaurus static dir so it's
served at `mattcantor.github.io/vestlang/talk/`:

```sh
cd docs/talk
npx reveal-md slides.md --static ../../apps/docs/static/talk
```

Docusaurus copies `apps/docs/static/**` verbatim to the site root, so the deck
runs as its own full-screen page outside the React shell. (The export dir is
generated output — decide whether to commit it or generate it in CI before the
summit.)

## Offline fallback for the room

The live `infer_schedule` encore (Beat 10) is the only part that needs the
network. Everything else runs offline:

- `npx reveal-md slides.md` locally on the laptop (port 1948), or
- `npx serve _site` on a static export.
