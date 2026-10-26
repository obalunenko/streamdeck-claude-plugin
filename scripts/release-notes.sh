#!/bin/sh
# Prints release notes for a tag in the goreleaser changelog format: the
# commits since the previous tag, oldest first, without merges and
# docs:/chore:/test: commits.
set -eu
tag="$1"
prev=$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)
echo "## Changelog"
git log --reverse --no-merges --format='* %H %s' "${prev:+$prev..}$tag" | grep -v -E '^\* [0-9a-f]+ (docs|chore|test):' || true
