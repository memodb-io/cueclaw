FROM node:22-slim

RUN groupadd -g 1000 agent && useradd -u 1000 -g agent -m agent

WORKDIR /app/agent-runner
COPY agent-runner/dist/ ./dist/
COPY agent-runner/node_modules/ ./node_modules/
COPY agent-runner/package.json ./

USER agent
ENTRYPOINT ["node", "/app/agent-runner/dist/index.js"]
