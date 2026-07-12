/* talk.js — DSL presentation helpers for the reveal-md deck:
 *   1. a `vest` highlight.js language, re-highlighting ```vest code blocks;
 *   2. dsl-grow — per-clause <span data-id> hosts so reveal's auto-animate
 *      can glide a statement's shared clauses between slides while a newly
 *      inserted clause fades in.
 *   3. dsl-lines — per-line <div> hosts whose fragments are authored in the
 *      markdown, so a statement grows one line per navigation step. talk.js
 *      only recolors each line; reveal owns the fragment stepping.
 */
(function () {
  "use strict";

  // ======================================================================
  // vest — a highlight.js language for the DSL, mirroring the docs' Prism
  // grammar (apps/docs/src/theme/prism-include-languages.ts) so the deck and
  // the site read the same. reveal's highlight plugin doesn't know `vest`, so
  // left alone a ```vest block gets AUTO-DETECTED (wrong colors). We register
  // the language against the plugin's own hljs, then re-highlight the blocks.
  // Token scopes match the docs' token names so talk.css colors line up.
  // ======================================================================
  function vestLanguage() {
    return {
      name: "vest",
      case_insensitive: true,
      contains: [
        { scope: "date", match: /\b\d{4}-\d{2}-\d{2}\b/ },
        { scope: "systemref", match: /\b(?:grant[-_]?date|vesting[-_]?start)\b/ },
        { scope: "verb", match: /\b(?:VEST|FROM|OVER|EVERY|CLIFF)\b/ },
        { scope: "selector", match: /\b(?:EARLIER|LATER|OF)\b/ },
        { scope: "constraint", match: /\b(?:BEFORE|AFTER|STRICTLY|AND|OR)\b/ },
        { scope: "anchor", match: /\b(?:EVENT|DATE)\b/ },
        { scope: "duration", match: /\b(?:YEARS?|MONTHS?|WEEKS?|DAYS?)\b/ },
        { scope: "number", match: /\b\d+(?:\.\d+)?\b/ },
        { scope: "ident", match: /\b[A-Za-z_][A-Za-z0-9_-]*\b/ },
        { scope: "punctuation", match: /[(),+\-\/]/ },
      ],
    };
  }

  // reveal's highlight plugin owns the only hljs instance on the page.
  function getHljs() {
    var plugin = Reveal.getPlugin && Reveal.getPlugin("highlight");
    var hljs = plugin && plugin.hljs;
    if (!hljs || !hljs.registerLanguage) return null;
    if (!hljs.getLanguage("vest")) hljs.registerLanguage("vest", vestLanguage);
    return hljs;
  }

  function setupVestHighlight(hljs) {
    var blocks = document.querySelectorAll(
      "pre code.language-vest, pre code.vest, code.language-vest",
    );
    // Re-color any vest blocks the plugin already auto-detected. textContent is
    // the untouched source; the string API skips the "already highlighted" guard.
    blocks.forEach(function (el) {
      el.innerHTML = hljs.highlight(el.textContent, { language: "vest" }).value;
      el.classList.add("hljs");
    });
  }

  // ======================================================================
  // dsl-grow — per-clause morph host. A <div class="dsl-grow"> holds a plain
  // DSL statement; we split it at clause keywords, wrap each clause in a
  // <span class="cl" data-id="c-KEYWORD">, and highlight it with the `vest`
  // grammar. The stable, keyword-derived data-ids let reveal's auto-animate
  // glide the shared clauses between two slides while a newly inserted clause
  // fades in. Highlighting a clause in isolation is safe — the grammar is a
  // flat list of per-token regexes with no cross-token state.
  // ======================================================================
  var CLAUSE_KW = /\s+(?=(?:VEST|FROM|OVER|EVERY|CLIFF|THEN|PLUS)\b)/i;

  function setupDslGrow(hljs) {
    var hosts = document.querySelectorAll("div.dsl-grow");
    hosts.forEach(function (host) {
      var text = host.textContent.trim().replace(/\s+/g, " ");
      if (!text) return;
      host.innerHTML = text
        .split(CLAUSE_KW)
        .map(function (clause) {
          var kw = (clause.match(/^([A-Za-z]+)/) || [])[1] || "x";
          var body = hljs.highlight(clause, { language: "vest" }).value;
          return (
            '<span class="cl" data-id="c-' + kw.toLowerCase() + '">' + body + "</span>"
          );
        })
        .join(" ");
    });
  }

  // ======================================================================
  // dsl-lines — line-by-line reveal. A <div class="dsl-lines"> holds one
  // <div class="dsl-line"> per statement line; every line after the first
  // also carries reveal's own .fragment class, authored right in the
  // markdown. Because the fragments exist before Reveal.initialize(), reveal
  // indexes them natively — no post-init inject + Reveal.sync() to gamble on.
  // We only recolor each line's text in place (highlighting a line in
  // isolation is safe: the grammar has no cross-line state), leaving the
  // .dsl-line / .fragment wrappers untouched. There's no <code>, so reveal's
  // highlight plugin never sees these blocks and can't flatten the spans.
  // ======================================================================
  function setupDslLines(hljs) {
    document.querySelectorAll(".dsl-lines").forEach(function (host) {
      var maxCols = 0;
      host.querySelectorAll(".dsl-line").forEach(function (el) {
        // Indent lives in CSS (i1/i2/i3 padding); fold it back in to size the box.
        var indent = el.classList.contains("i3")
          ? 6
          : el.classList.contains("i2")
            ? 4
            : el.classList.contains("i1")
              ? 2
              : 0;
        maxCols = Math.max(maxCols, el.textContent.length + indent);
        el.innerHTML = hljs.highlight(el.textContent, { language: "vest" }).value;
      });
      // Pin the block to its widest line (in ch) so it stays put as fragments
      // reveal, rather than re-centering each time a longer line appears.
      host.style.width = maxCols + 1 + "ch";
    });
  }

  function onReady() {
    var hljs = getHljs();
    if (!hljs) return;
    setupVestHighlight(hljs);
    setupDslGrow(hljs);
    setupDslLines(hljs);
    // Recompute scaling now that recolored blocks have their final size.
    if (Reveal.layout) Reveal.layout();
  }

  // Reveal may or may not be ready when this script runs; handle both.
  (function waitForReveal() {
    if (window.Reveal && Reveal.isReady) {
      if (Reveal.isReady()) onReady();
      else Reveal.on("ready", onReady);
      return;
    }
    setTimeout(waitForReveal, 50);
  })();
})();
