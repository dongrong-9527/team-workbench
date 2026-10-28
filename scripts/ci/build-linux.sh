#!/usr/bin/env bash
# Runs inside the pinned official build image; /source is the exact app checkout.
set -euo pipefail
node /config/scripts/ci/artifact.mjs source /source
node --test /config/scripts/ci/artifact.test.mjs
cd /source
npm ci --include=optional --no-audit --no-fund
npm run typecheck
npm run build
mkdir /work/dependencies
cp package.json package-lock.json /work/dependencies/
cd /work/dependencies
npm ci --omit=dev --include=optional --workspaces=false --no-audit --no-fund
# License installed by the official Node image alongside the runtime.
cp /usr/local/LICENSE node-LICENSE
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
import { BUILD_IMAGE } from '/config/scripts/ci/artifact.mjs';
writeFileSync('runtime-provenance.json', JSON.stringify({ nodeVersion: process.versions.node, nodeABI: process.versions.modules, arch: process.arch, platform: process.platform, buildGlibc: process.report.getReport().header.glibcVersionRuntime, buildImage: BUILD_IMAGE }));
JS
cd /source
npm run package:release -- /source /work/candidate /work/dependencies /usr/local/bin/node candidate-9bf0241 > /work/package-build.log
node /config/scripts/ci/artifact.mjs audit /work/candidate
mkdir /work/delivery /work/unpacked
tar -czf /work/delivery/candidate.tar.gz -C /work candidate
tar -xzf /work/delivery/candidate.tar.gz -C /work/unpacked --no-same-owner
node /config/scripts/ci/artifact.mjs audit /work/unpacked/candidate
