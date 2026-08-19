#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_PATH:?GITHUB_PATH must be set}"
: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"

shim_dir="$PWD/.runtime-ci-bin"
mkdir -p "$shim_dir"

cat > "$shim_dir/pg-client" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

tool="$(basename "$0")"
: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"

exec docker run --rm --network host \
  -v "$PWD:$PWD" \
  -w "$PWD" \
  -v "$RUNNER_TEMP:$RUNNER_TEMP" \
  -e PGPASSWORD="${PGPASSWORD:-}" \
  postgis/postgis:16-3.4 \
  "$tool" "$@"
EOF
chmod +x "$shim_dir/pg-client"

for tool in psql createdb pg_dump pg_restore; do
  ln -sf pg-client "$shim_dir/$tool"
done

echo "$shim_dir" >> "$GITHUB_PATH"

# Validate that every shim resolves through the pinned container image without
# making a database connection. This catches missing binaries before migrations.
for tool in psql createdb pg_dump pg_restore; do
  "$shim_dir/$tool" --version >/dev/null
done
