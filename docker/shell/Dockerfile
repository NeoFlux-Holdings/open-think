# Helm Shell — Cloudflare-Container-hosted bash, fronted by a Node WS↔PTY
# bridge. Two-stage build keeps the final image small (~150 MB) by leaving
# the C++ toolchain in the builder.
#
# Persistence: when R2_* env vars are set, /persist is rclone-mounted to
# the configured R2 bucket. /workspace stays ephemeral (fast, disposable).
# Helper scripts ship in PATH:
#   helm-save  — tar+gzip /workspace into /persist/sessions/<id>/
#   helm-load  — restore the latest snapshot
#   helm       — send a prompt to the Worker's conductor and stream the
#                response back (uses HELM_INTERNAL_TOKEN auth)

# ---- builder: compile node-pty + native deps ---------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++ build-base
WORKDIR /opt/shell
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime ----------------------------------------------------------
FROM node:22-alpine

# System tools every Helm operator wants. `fuse` + `rclone` enable the
# /persist mount; `tar`/`gzip` are for helm-save snapshots; `jq`/`curl`
# back the `helm` REPL.
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
    ca-certificates \
    fuse \
    rclone \
    tar \
    gzip \
    sudo \
    tini \
    && rm -rf /var/cache/apk/*

# Allow non-root user to use FUSE (needed for rclone mount inside the
# helm user's session). `user_allow_other` is intentionally NOT set so
# the mount is private to the helm user.
RUN echo "user_allow_other" > /etc/fuse.conf

# Non-root user. uid 1100 is arbitrary; just away from the Alpine defaults.
RUN addgroup -g 1100 helm \
    && adduser -D -u 1100 -G helm -s /bin/bash -h /workspace helm \
    && mkdir -p /workspace /persist /opt/shell \
    && chown -R helm:helm /workspace /persist /opt/shell

# Bring the prebuilt node-pty over from the builder. Saves ~250 MB and
# ~30 s by not recompiling at runtime.
COPY --from=builder /opt/shell/node_modules /opt/shell/node_modules
COPY package.json server.mjs motd.txt /opt/shell/

# Helper scripts. We copy as root so they end up 0755 owned by root —
# users can run but not modify.
COPY entrypoint.sh /usr/local/bin/entrypoint
COPY helm-save /usr/local/bin/helm-save
COPY helm-load /usr/local/bin/helm-load
COPY helm /usr/local/bin/helm
RUN chmod +x /usr/local/bin/entrypoint \
    /usr/local/bin/helm-save \
    /usr/local/bin/helm-load \
    /usr/local/bin/helm \
    && chown -R helm:helm /opt/shell

ENV NODE_ENV=production \
    SHELL=/bin/bash \
    LANG=C.UTF-8 \
    TERM=xterm-256color \
    HELM_SHELL_PORT=7681 \
    PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin

EXPOSE 7681
USER helm
WORKDIR /workspace

# `tini` reaps zombies (interactive shells fork heavily) and forwards
# signals so SIGTERM from the CF scheduler shuts the bridge down cleanly.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/entrypoint"]
