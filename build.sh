#!/bin/sh
# Builds dist/sent-in-threads-<version>.xpi from src/
set -e
cd "$(dirname "$0")"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src/manifest.json | head -1)
mkdir -p dist
OUT="dist/sent-in-threads-$VERSION.xpi"
rm -f "$OUT"
(cd src && zip -r -q -X "../$OUT" .)
echo "$OUT"
