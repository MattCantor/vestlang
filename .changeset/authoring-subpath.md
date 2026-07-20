---
"@vestlang/vestlang": minor
---

New `@vestlang/vestlang/authoring` subpath for turning prose into vestlang when you
call an LLM yourself. It ships the authoring prompt, a `validateVestlang` parse-and-lint
check, the corrective re-prompt, and `authorVestlang` — a propose → verify → refine loop
that grows one conversation across attempts. There is no model SDK and no transport: you
supply a `complete` function that runs a single turn against whatever client you already
use, and the loop calls it up to `maxAttempts` times.

A reply of exactly `INDETERMINATE` comes back as its own outcome rather than a failure, so
prose that pins down no schedule is distinguishable from prose the model got wrong. Note
that a successful result attests the statement parses and lints — not that it means what
the prose meant; pair it with `verifyObservations` when you have figures to check against.

The main `@vestlang/vestlang` entry is unchanged, and the prompt does not load unless you
import the subpath.
