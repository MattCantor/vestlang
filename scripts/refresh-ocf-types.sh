#!/usr/bin/env bash
#
# Refresh the vendored OCF types from Open-Cap-Format-OCF.
#
# TEMPORARY tooling: the whole vendored-types transport (this script + the
# tsconfig `paths` alias + vendor/ocf-types.d.ts) goes away once
# @opencaptablecoalition/ocf-types is published to npm. Until then, regenerate
# with this after the schema repo's types change.
#
#   pnpm ocf:refresh-types -- <path-to-Open-Cap-Format-OCF> [git-ref]
#   e.g. pnpm ocf:refresh-types -- ~/code/Open-Cap-Format-OCF ca06c7f2
#   (after PR 587 merges:   ... -- ~/code/Open-Cap-Format-OCF main)
#
# It runs `npm install --ignore-scripts` and the type generator IN THE SCHEMA
# REPO, so only point it at a checkout you trust.
set -euo pipefail

FMT_DIR="${1:?usage: refresh-ocf-types.sh <Open-Cap-Format-OCF checkout> [ref]}"
REF="${2:-ca06c7f2}"

# Provenance constants. The default ref is a bare commit (detached HEAD), so git
# has no branch/PR to read back — hardcode them. Once 587 merges to main,
# retarget: pass `main` as the ref and update these to "merged to main".
PR="#587"
BRANCH="vesting-dom-plumbing"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/ocf-types.d.ts"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

(
  cd "$FMT_DIR"
  git fetch --quiet --all
  git checkout --quiet "$REF"
  npm install --ignore-scripts --no-audit --no-fund >/dev/null 2>&1
  # --experimental is a tri-state mode, not a boolean; only `compatibility`
  # emits the V1|V2 union (incl. OCFVestingTermsV2) we consume.
  npm run --silent schema:gen-types -- --out "$TMP" --experimental compatibility >/dev/null
)
SHA="$(git -C "$FMT_DIR" rev-parse --short HEAD)"

{
  cat <<EOF
// ============================================================================
// VENDORED — temporary transport for OCF v2-alpha types (#495).
//
// Source  : Open-Cap-Table-Coalition/Open-Cap-Format-OCF
// PR      : ${PR} (vesting v2; x-ocf-stability: alpha) — UNMERGED
// Branch  : ${BRANCH}
// Commit  : ${SHA}
// Built by: npm run schema:gen-types -- --experimental compatibility
//           (the default version-dispatch mode — emits the V1|V2 union incl.
//            OCFVestingTermsV2; never use \`unstable\`/\`none\`, which drop it)
//
// DO NOT EDIT BY HAND. Stop-gap until @opencaptablecoalition/ocf-types ships on
// npm. Consumers import the FINAL specifier via the tsconfig "paths" alias:
//   import type { … } from "@opencaptablecoalition/ocf-types";
//
// Regenerate : pnpm ocf:refresh-types -- <Open-Cap-Format-OCF checkout> [ref]
// Replacement path (this file + the tsconfig alias):
//   1. PR 587 merges to main -> pnpm ocf:refresh-types -- <checkout> main
//   2. Release tarball exists  -> npm i -D <tarball-url>; delete this file + alias
//   3. npm publish             -> npm i -D @opencaptablecoalition/ocf-types
// ============================================================================

EOF
  cat "$TMP"
} >"$DEST"

echo "Vendored vendor/ocf-types.d.ts from ${BRANCH} ${PR} (${SHA})"
