#!/usr/bin/env bash
# Usage: bash scripts/ci/package-linux.sh EXACT_SOURCE_CHECKOUT FRESH_OUTPUT
# All build products stay outside both source/config repositories.
set -euo pipefail
source_dir=$(realpath "$1")
output_dir=$(realpath -m "$2")
config_dir=$(cd "$(dirname "$0")/../.." && pwd)
config_sha=$(git -C "$config_dir" rev-parse HEAD)
case "$output_dir/" in "$source_dir/"*|"$config_dir/"*) echo 'Output must be outside both checkouts' >&2; exit 1;; esac
mkdir "$output_dir"
# This optional local trust bundle is never copied into source or the artifact.
ca_args=()
if [[ -n "${CI_EXTRA_CA_FILE:-}" ]]; then
  ca_args=(-v "$(realpath "$CI_EXTRA_CA_FILE"):/trust/extra-ca.pem:ro" -e NODE_EXTRA_CA_CERTS=/trust/extra-ca.pem)
fi
build_image=node:24.21.0-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0
smoke_image=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
# No Docker socket, credentials, host home or private documents enter containers.
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e NPM_CONFIG_USERCONFIG=/dev/null "${ca_args[@]}" \
  -v "$source_dir:/source" -v "$config_dir/scripts/ci:/config/scripts/ci:ro" -v "$output_dir:/work" \
  "$build_image" bash /config/scripts/ci/build-linux.sh
# The actual extracted package is read-only; fixture data is temporary and has no network route.
docker run --rm --platform linux/amd64 --network none --user "$(id -u):$(id -g)" \
  --cpus 2 --memory 2g --memory-swap 2g -e HOME=/tmp \
  -v "$output_dir/unpacked/candidate:/package:ro" -v "$config_dir/scripts/ci:/helpers:ro" -v "$output_dir:/work" \
  "$smoke_image" /package/runtime/node /helpers/smoke.mjs /package /work/smoke.json
docker run --rm --platform linux/amd64 --network none --user "$(id -u):$(id -g)" \
  -v "$output_dir:/work" -v "$config_dir/scripts/ci:/helpers:ro" \
  "$smoke_image" /work/unpacked/candidate/runtime/node /helpers/artifact.mjs finalize /work/unpacked/candidate /work/delivery /work/smoke.json "$config_sha"
(cd "$output_dir/delivery" && sha256sum --check SHA256SUMS)
