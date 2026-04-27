/**
 * Reusable "Don't have a Cloudflare account yet?" panel.
 *
 * Surfaced at the top of /deploy/cloud and /deploy/guided. The CTA is
 * Cloudflare's own one-click "Deploy to Cloudflare" button, which:
 *   - Walks the user through CF signup if they're not logged in
 *   - Forks the repo to their GitHub
 *   - Reads `cloudflare.bindings` from package.json + auto-prompts for any
 *   - Creates the Worker in their account, deploys it
 *
 * After they finish that flow, they're done with the OSS path. To upgrade
 * to Helm Cloud (managed updates) they come back to /deploy/cloud and
 * paste a token — at that point we just persist + cron-push from then on.
 *
 * The panel is dismissible (sets `oth_hide_no_account_panel=1` cookie for
 * 90 days) so existing CF users don't see it on every visit.
 */

const REPO_URL = "https://github.com/NeoFlux-Holdings/open-think";
const DEPLOY_BUTTON_URL = `https://deploy.workers.cloudflare.com/?url=${encodeURIComponent(REPO_URL)}`;

export function renderNoAccountPanel(): string {
  return `<div id="no-account-panel" class="no-account-panel" hidden>
    <button class="no-account-dismiss" data-dismiss="no-account" aria-label="dismiss">×</button>
    <div class="mono no-account-eyebrow">first time on cloudflare?</div>
    <h3 class="serif no-account-title">No account? Cloudflare's "Deploy" flow handles signup + first deploy in one shot.</h3>
    <p>
      Click the button — it opens
      <a href="https://deploy.workers.cloudflare.com/" target="_blank" rel="noopener">deploy.workers.cloudflare.com</a>
      which walks you through signup (if needed), forks the repo to your GitHub, and runs the first
      deploy in your fresh account. Comes back with a working Worker URL.
      You can come back to this page after to enable Helm Cloud's managed updates.
    </p>
    <div class="no-account-actions">
      <a class="btn primary" href="${DEPLOY_BUTTON_URL}" target="_blank" rel="noopener">
        Deploy to Cloudflare <span class="arrow">↗</span>
      </a>
      <button class="btn ghost no-account-already" data-dismiss="no-account">I already have an account →</button>
    </div>
  </div>

  <style>
    .no-account-panel {
      position: relative;
      margin-top: 18px;
      padding: 18px 22px;
      border: 1px dashed var(--muted-2);
      background: var(--shade);
    }
    .no-account-eyebrow {
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .no-account-title {
      margin: 0 0 10px;
      font-size: 22px;
      letter-spacing: -0.01em;
    }
    .no-account-panel p {
      font-size: 14px;
      max-width: 64ch;
      margin: 0 0 14px;
    }
    .no-account-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .no-account-dismiss {
      position: absolute;
      top: 8px; right: 12px;
      background: transparent;
      border: none;
      font-size: 18px;
      color: var(--muted);
      cursor: pointer;
      padding: 4px 8px;
    }
    .no-account-dismiss:hover { color: var(--accent); }
  </style>

  <script>
    (function () {
      const cookieFlag = 'oth_hide_no_account_panel';
      const has = document.cookie.split(';').some(function (c) {
        return c.trim().indexOf(cookieFlag + '=1') === 0;
      });
      const panel = document.getElementById('no-account-panel');
      if (!panel) return;
      if (!has) panel.removeAttribute('hidden');
      // Dismiss buttons (×  or "I already have an account").
      panel.querySelectorAll('[data-dismiss="no-account"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          panel.setAttribute('hidden', '');
          // 90 days
          const exp = new Date(Date.now() + 90 * 86400000).toUTCString();
          document.cookie = cookieFlag + '=1; path=/; max-age=' + (90 * 86400) + '; expires=' + exp + '; samesite=lax';
        });
      });
    })();
  </script>`;
}
