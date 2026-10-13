#!/usr/bin/env bash
# Builds the generator at a given git ref (default: main) into .parity/baseline/build.
# The parity tests compare the current code's output against this build.
set -euo pipefail
ref="${1:-main}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/.parity/baseline"
rm -rf "$out" && mkdir -p "$out"
git -C "$root" archive "$ref" src tsconfig.json | tar -x -C "$out"
# Resolve the baseline's dependencies from this repo's node_modules
ln -s "$root/node_modules" "$out/node_modules"
(cd "$out" && node "$root/node_modules/typescript-6/bin/tsc" -p tsconfig.json --outDir build --rootDir src --incremental false --ignoreDeprecations 6.0 --noCheck --esModuleInterop false)
echo "Built baseline ($ref @ $(git -C "$root" rev-parse --short "$ref")) into $out/build"
