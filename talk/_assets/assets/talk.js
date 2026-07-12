/* talk.js — DSL presentation helpers for the reveal-md deck:
 *   1. a `vest` highlight.js language, re-highlighting ```vest code blocks;
 *   2. dsl-grow — per-clause <span data-id> hosts so reveal's auto-animate
 *      can glide a statement's shared clauses between slides while a newly
 *      inserted clause fades in.
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
  // dsl-lines — line-by-line reveal. A <pre class="dsl-lines"><code> holds a
  // multi-line statement; each line is highlighted and every line after the
  // first is wrapped in a reveal .fragment, so the statement grows one line
  // per navigation step (the capstone builds its nested cliff in front of the
  // audience). Per-line highlighting is safe: the grammar has no cross-line
  // state. reveal's default fragment style reserves the line's space, so the
  // lines fade in place rather than shoving the block around.
  // ======================================================================
  function setupDslLines(hljs) {
    document.querySelectorAll("pre.dsl-lines code").forEach(function (el) {
      var lines = el.textContent.replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
      el.innerHTML = lines
        .map(function (line, i) {
          var body = hljs.highlight(line, { language: "vest" }).value;
          return i === 0
            ? "<span>" + body + "</span>"
            : '<span class="fragment">' + body + "</span>";
        })
        .join("\n");
      el.classList.add("hljs");
    });
  }

  function onReady() {
    var hljs = getHljs();
    if (!hljs) return;
    setupVestHighlight(hljs);
    setupDslGrow(hljs);
    setupDslLines(hljs);
    // We inject .fragment elements after init; re-index so reveal reveals them.
    if (Reveal.sync) Reveal.sync();
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
