#!/usr/bin/env bash
set -euo pipefail

bin_dir="${ROS_PG_CLIENT_BIN_DIR:-$PWD/.runtime-ci-bin}"
mkdir -p "$bin_dir"

cat > "$bin_dir/pg-client" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

tool="$(basename "$0")"
args=(docker run --rm --network host)

if [[ -n "${PWD:-}" ]]; then
  args+=( -v "$PWD:$PWD" -w "$PWD" )
fi
if [[ -n "${RUNNER_TEMP:-}" ]]; then
  args+=( -v "$RUNNER_TEMP:$RUNNER_TEMP" )
fi
if [[ -n "${PGPASSWORD:-}" ]]; then
  args+=( -e PGPASSWORD="$PGPASSWORD" )
fi

args+=( postgis/postgis:16-3.4 "$tool" )
exec "${args[@]}" "$@"
EOF

chmod +x "$bin_dir/pg-client"
for tool in psql createdb pg_dump pg_restore; do
  ln -sf pg-client "$bin_dir/$tool"
done

printf '%s\n' "$bin_dir"
