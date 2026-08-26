#!/usr/bin/env bash
set -euo pipefail

validation_edge="${PICBIND_VALIDATION_EDGE:-1600}"
if [[ "${1:-}" == "--all" ]]; then
  targets=(aarch64-apple-darwin x86_64-apple-darwin)
elif [[ "$#" -gt 0 ]]; then
  targets=("$@")
else
  host_target="$(rustc -vV | /usr/bin/awk '/^host:/ { print $2 }')"
  targets=("$host_target")
fi

for target in "${targets[@]}"; do
  if [[ "$target" != "aarch64-apple-darwin" && "$target" != "x86_64-apple-darwin" ]]; then
    echo "Unsupported macOS validation target: $target" >&2
    exit 2
  fi
done

for target in "${targets[@]}"; do
  if ! rustup target list --installed | /usr/bin/grep -qx "$target"; then
    echo "Missing Rust target: $target" >&2
    echo "Install it with: rustup target add $target" >&2
    exit 2
  fi
done

for target in "${targets[@]}"; do
  cargo test -p picbind-image-native --target "$target" --release --offline
  cargo build -p picbind-image-native \
    --example native_validation \
    --target "$target" \
    --release \
    --offline

  binary="target/$target/release/examples/native_validation"
  if [[ "$target" == "x86_64-apple-darwin" ]]; then
    /usr/bin/time -l env PICBIND_VALIDATION_EDGE="$validation_edge" arch -x86_64 "$binary"
  else
    /usr/bin/time -l env PICBIND_VALIDATION_EDGE="$validation_edge" "$binary"
  fi
done
