# Helm Shell — a Cloudflare-Container-hosted bash session, fronted by a
# tiny Node WebSocket↔PTY bridge so xterm.js (browser) and our CLI client
# can both attach via a single WS pipe through the Worker.
#
# We use Node 22 (the image's pinned LTS) + `node-pty` for real PTY
# semantics (line discipline, signals, resize). `ws` for the WebSocket
# server. The image deliberately runs as a non-root `helm` user inside
# /workspace — Cloudflare Containers nuke disk on sleep anyway, but
# defense-in-depth never hurt.
#
# Pre-installed shell tools (the bare minimum that makes a Helm operator
# productive without `apk add` every session): bash, git, curl, jq, less,
# vim-tiny, htop, tmux, openssh-client (for cloudflared access ssh proxying
# OUT to other infra), python3, build-base (for native modules at runtime).

FROM node:22-alpine

# ---- system tools ----------------------------------------------------------
RUN apk add --no-cache \
    bash \
    git \
    curl \
    jq \
    less \
    vim \
    htop \
    tmux \
    ncurses \
    openssh-client \
    python3 \
    py3-pip \
    build-base \
    sudo \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# ---- non-root user ---------------------------------------------------------
RUN addgroup -g 1100 helm \
    && adduser -D -u 1100 -G helm -s /bin/bash -h /workspace helm \
    && mkdir -p /workspace \
    && chown -R helm:helm /workspace

# ---- node deps for the WS bridge ------------------------------------------
WORKDIR /opt/shell
COPY package.json package-lock.json* ./
# node-pty needs python + g++; we already installed build-base above.
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY server.mjs ./
COPY motd.txt ./

# Wrangler is handy for in-shell ops (`wrangler tail`, etc.) but bloats the
# image. Skip by default; users can `npm i -g wrangler` per session if they
# really want it.

# ---- runtime ---------------------------------------------------------------
ENV NODE_ENV=production \
    SHELL=/bin/bash \
    LANG=C.UTF-8 \
    TERM=xterm-256color \
    HELM_SHELL_PORT=7681

EXPOSE 7681
USER helm
WORKDIR /workspace

# The bridge runs as the `helm` user; spawned bash inherits the same uid.
CMD ["node", "/opt/shell/server.mjs"]
