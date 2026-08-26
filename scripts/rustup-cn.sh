#!/usr/bin/env bash

# Use rsproxy.cn for rustup downloads. Existing values take precedence so
# callers can switch to another mirror without changing this helper.
export RUSTUP_DIST_SERVER="${RUSTUP_DIST_SERVER:-https://rsproxy.cn}"
export RUSTUP_UPDATE_ROOT="${RUSTUP_UPDATE_ROOT:-https://rsproxy.cn/rustup}"

# The helper can either be sourced to configure the current shell or executed
# as a drop-in wrapper for a single rustup command.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  exec rustup "$@"
fi
