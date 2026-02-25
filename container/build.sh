#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/agent-runner"
pnpm install
pnpm build

cd ..
docker build -t cueclaw-agent:latest .
echo "Container image built: cueclaw-agent:latest"
