# Helm Sandbox image — extends Cloudflare's official sandbox base.
#
# The Sandbox SDK ships a turnkey Linux environment (bash, git, curl,
# python, node, ffmpeg, etc.) plus the PTY/exec/file-watch protocol the
# Worker-side @cloudflare/sandbox SDK speaks to. Versioning is pinned
# so a new SDK release doesn't change container behavior under us.
#
# `wrangler deploy` builds + pushes this from CF's remote builder; no
# local Docker daemon required. To customize (e.g. install extra tools,
# bake in helm REPL helpers like `helm fetch`/`helm save`), add RUN
# layers BELOW this line. Keep the FROM pinned.
FROM docker.io/cloudflare/sandbox:0.10.0

# Sandbox's HTTP/PTY bridge listens on 8080. Documenting it for clarity;
# CF doesn't enforce EXPOSE but it's standard Docker convention.
EXPOSE 8080
