#!/bin/sh
# Helm Shell container entrypoint. Mounts /persist via rclone (if R2 env
# vars are set), then optionally restores the latest workspace snapshot,
# then exec's the Node bridge. Each step is best-effort — the bridge MUST
# start so the user can at least get a usable shell; persistence failures
# print a banner but don't block.

set -e

log() { echo "[entrypoint] $*"; }

# ---- 1. Set up rclone for R2 (if creds present) ----
if [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && \
   [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_BUCKET:-}" ]; then
  log "configuring rclone for R2 bucket=${R2_BUCKET}"
  mkdir -p "$HOME/.config/rclone"
  cat > "$HOME/.config/rclone/rclone.conf" <<RCLONE_EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
RCLONE_EOF
  chmod 600 "$HOME/.config/rclone/rclone.conf"

  # Daemon mode so we don't block the entrypoint. --vfs-cache-mode=writes
  # buffers writes locally (fast for editor saves; flushes on close). Logs
  # land at /tmp/rclone.log so users can `tail -f /tmp/rclone.log` if
  # /persist behaves oddly.
  if rclone mount "r2:${R2_BUCKET}" /persist \
       --daemon \
       --vfs-cache-mode=writes \
       --dir-cache-time=10s \
       --log-file=/tmp/rclone.log \
       --log-level=INFO 2>>/tmp/rclone.log; then
    log "rclone mount r2:${R2_BUCKET} → /persist (logs: /tmp/rclone.log)"
    # Wait briefly for the mount to settle so helm-load below sees files.
    for _ in 1 2 3 4 5; do
      if mountpoint -q /persist; then break; fi
      sleep 0.3
    done
  else
    log "rclone mount FAILED (see /tmp/rclone.log) — /persist will be ephemeral"
  fi
else
  log "R2_* env vars not set — /persist is ephemeral (no FUSE mount)"
fi

# ---- 2. Auto-restore previous workspace snapshot (best effort) ----
SNAPSHOT="/persist/sessions/${HELM_SESSION:-default}/latest.tar.gz"
if [ -e "$SNAPSHOT" ] && [ -z "$(ls -A /workspace 2>/dev/null)" ]; then
  log "auto-restoring /workspace from $SNAPSHOT"
  tar -C / -xzf "$SNAPSHOT" 2>>/tmp/helm-restore.log \
    && log "restore complete" \
    || log "restore FAILED (see /tmp/helm-restore.log)"
fi

# ---- 3. Exec the bridge. PID 1 from now on. ----
log "starting bridge on :${HELM_SHELL_PORT:-7681}"
exec node /opt/shell/server.mjs
