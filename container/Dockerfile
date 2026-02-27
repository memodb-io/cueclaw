FROM node:22-slim

RUN groupadd -g 1000 agent 2>/dev/null || true && useradd -u 1000 -g 1000 -m agent 2>/dev/null || true

WORKDIR /app/agent-runner
COPY agent-runner/dist/ ./dist/
COPY agent-runner/node_modules/ ./node_modules/
COPY agent-runner/package.json ./

USER agent
ENTRYPOINT ["node", "/app/agent-runner/dist/index.js"]
