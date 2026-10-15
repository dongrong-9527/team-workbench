#!/bin/sh
# Read-only inspection. Never installs packages, migrates data or changes security.
set -eu
cat /etc/os-release
uname -m
getconf GNU_LIBC_VERSION
free -h
df -hT "${DATA_DIRECTORY:-/var/lib/workbench}"
if command -v ss >/dev/null 2>&1; then ss -lnt; fi
if command -v rpm >/dev/null 2>&1; then rpm -q nginx nodejs || true; fi
if command -v nginx >/dev/null 2>&1; then nginx -v; fi
if [ -n "${DATA_DIRECTORY:-}" ]; then
 test -d "$DATA_DIRECTORY" && test -r "$DATA_DIRECTORY" && test -w "$DATA_DIRECTORY" || { echo 'Data directory is not accessible to this user' >&2; exit 1; }
fi
if [ -n "${RELEASE_DIRECTORY:-}" ]; then
 "$RELEASE_DIRECTORY/runtime/node" "$RELEASE_DIRECTORY/apps/api/dist/scripts/verify-runtime.js" "$RELEASE_DIRECTORY"
fi
