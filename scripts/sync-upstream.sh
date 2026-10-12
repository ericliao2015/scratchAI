#!/usr/bin/env bash
# Apply changes from TurboWarp/scratch-gui since the commit recorded in docs/UPSTREAM.md.
set -euo pipefail
cd "$(dirname "$0")/.."

base=$(grep -oE '`[0-9a-f]{40}`' docs/UPSTREAM.md | head -n1 | tr -d '`')
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git clone --quiet --filter=blob:none --branch develop https://github.com/TurboWarp/scratch-gui "$tmp/upstream"
head=$(git -C "$tmp/upstream" rev-parse HEAD)
if [ "$base" = "$head" ]; then
    echo "Already up to date ($head)"
    exit 0
fi

echo "Applying upstream $base..$head"
git -C "$tmp/upstream" diff --binary "$base" "$head" > "$tmp/upstream.patch"
git apply -3 "$tmp/upstream.patch" || echo "Conflicts found: resolve them, then commit."
sed -i "s/$base/$head/" docs/UPSTREAM.md
echo "Updated docs/UPSTREAM.md to $head"
