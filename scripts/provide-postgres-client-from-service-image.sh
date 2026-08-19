#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_PATH:?GITHUB_PATH must be set by GitHub Actions}"

bin_dir="$PWD/.runtime-ci-bin"
mkdir -p "$bin_dir"

cat > "$bin_dir/pg-client" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

tool="$(basename "$0")"
runner_temp="${RUNNER_TEMP:-/tmp}"

exec docker run --rm --network host \
  -v "$PWD:$PWD" \
  -w "$PWD" \
  -v "$runner_temp:$runner_temp" \
  -e PGPASSWORD="${PGPASSWORD:-}" \
  postgis/postgis:16-3.4 \
  "$tool" "$@"
EOF

chmod +x "$bin_dir/pg-client"
for tool in psql createdb pg_dump pg_restore; do
  ln -sf pg-client "$bin_dir/$tool"
done

printf '%s\n' "$bin_dir" >> "$GITHUB_PATH"
