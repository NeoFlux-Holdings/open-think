FROM node:22-slim

# Build deps for native modules the codex CLI may pull in.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

# Install the Codex CLI. Swap the package name if OpenAI publishes under a
# different npm name in your environment.
RUN npm install -g @openai/codex || npm install -g codex

WORKDIR /app
COPY package.json ./
COPY server.mjs ./

ENV PORT=8787
EXPOSE 8787

# Auth state lives here. Mount a volume (or an emptyDir you seed once after
# `codex login`) so the subscription token survives container restarts.
VOLUME ["/root/.codex"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.mjs"]
