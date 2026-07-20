---
"@vestlang/vestlang": minor
---

Add `VESTLANG_GRAMMAR_GUIDE` to `@vestlang/vestlang/authoring`: the same grammar
material as `VESTLANG_AUTHORING_PROMPT` — the statement form, anchors, selectors,
conditions, worked translations, and the mistakes that fail validation — with the
reply-format rules left out, so you can hand it to a chat agent or drop it into
your own docs without telling the reader to answer with a bare DSL string.

`VESTLANG_AUTHORING_PROMPT` changes by one sentence in the process: the bullet
that read "One reply may hold more than one statement" now reads "One program may
hold more than one statement", since both texts are built from one template. What
it teaches is unchanged, but the string is no longer byte-identical to the last
release — worth a look if you snapshot it or diff it in your own tests.
