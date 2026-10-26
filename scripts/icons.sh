#!/bin/sh
# Renders the static manifest icons from SVG with sips.
set -eu
out="$(dirname "$0")/../com.obalunenko.claudeperm.sdPlugin/imgs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

icon() { # name color label size
  for scale in 1 2; do
    px=$((72 * scale))
    suffix=$([ "$scale" = 2 ] && echo "@2x" || echo "")
    cat > "$tmp/$1.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$px" height="$px" viewBox="0 0 72 72"><rect width="72" height="72" rx="10" fill="$2"/><text x="36" y="$((36 + $4 / 3))" font-family="Helvetica" font-size="$4" font-weight="bold" fill="#fff" text-anchor="middle">$3</text></svg>
SVG
    sips -s format png "$tmp/$1.svg" --out "$out/$1$suffix.png" >/dev/null
  done
}

icon plugin '#d97757' '?' 40
icon category '#d97757' '?' 40
icon status '#2b2b2b' 'idle' 16
icon allow '#2e7d32' 'Allow' 16
icon always '#1565c0' 'Always' 15
icon deny '#c62828' 'Deny' 16
icon option1 '#6a1b9a' '1' 36
icon option2 '#6a1b9a' '2' 36
icon option3 '#6a1b9a' '3' 36
icon option4 '#6a1b9a' '4' 36
icon strip '#6a1b9a' '⇆' 36
icon tune '#1565c0' '◎' 36
icon usage '#2e7d32' '▮' 36
