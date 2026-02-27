#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/agent-runner"
pnpm install
pnpm build

cd ..

# Read version from package.json
VERSION=$(node -p "require('../package.json').version")

docker build \
  -t cueclaw-agent:latest \
  -t "ghcr.io/memodb-io/cueclaw-agent:latest" \
  -t "ghcr.io/memodb-io/cueclaw-agent:${VERSION}" \
  .
echo "Container image built: cueclaw-agent:latest, ghcr.io/memodb-io/cueclaw-agent:{latest,${VERSION}}"
