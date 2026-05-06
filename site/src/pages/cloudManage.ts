import { htmlHead, htmlFoot, escapeHtml } from "../layout";
import type { CloudDeploymentRow, PushLogEntry } from "../cloud/deployments";

/**
 * /cloud/manage — the subscriber-facing dashboard for a Helm Cloud deployment.
 *
 * Auth model: the URL carries a `?token=...` that resolves to a single
 * deployment via `cloud_manage_tokens`. Tokens expire after 30 days; the
 * subscriber can issue a fresh one from the page itself.
 *
 * Server renders the current state; client-side JS calls /api/cloud/manage/*
 * for the four actions (pause / resume / rotate-token / cancel-subscription).
 */

interface ManagePageInput {
  deployment: CloudDeploymentRow;
  manageToken: string;
  log: PushLogEntry[];
  /** Customer's email for display only (looked up from the customers table). */
  email?: string;
}

export function renderCloudManage(input: ManagePageInput): string {
  const { deployment, manageToken, log, email } = input;
  const paused = deployment.paused === 1;
  const lastPushed = deployment.lastPushedAt ?? "never";
  const sha = deployment.buildSha ? deployment.buildSha.slice(0, 8) : "—";
  const lastErr = deployment.lastPushError ?? "";

  const logRows = log
    .slice(0, 20)
    .map(
      (e) => `<tr>
      <td class="mono small">${escapeHtml(e.ts)}</td>
      <td class="mono small ${kindClass(e.kind)}">${escapeHtml(e.kind)}</td>
      <td class="mono small">${escapeHtml(e.buildSha?.slice(0, 8) ?? "")}</td>
      <td class="small">${escapeHtml(e.detail ?? "")}</td>
    </tr>`
    )
    .join("");

  return `${htmlHead({
    title: "Manage Helm Cloud",
    description: "Pause updates, rotate your Cloudflare token, or cancel your Helm Cloud subscription."
  })}
<main>
<section class="reveal d1" style="padding-top: 36px;">
  <div class="edition mono">§11 · Helm Cloud · manage</div>
  <h1 class="serif" style="font-size: clamp(40px, 6vw, 64px); max-width: 22ch;">
    Your <em>${escapeHtml(deployment.workerName)}</em> deployment.
  </h1>
  <p class="sub" style="max-width: 60ch;">
    Helm Cloud pushes new releases to your Worker on a schedule. You can
    pause updates anytime; the Worker keeps running on the version we last
    pushed. Cancel your subscription and we stop pushing — your Worker is
    still yours.
  </p>
</section>

<section class="reveal d2 cloud-step">
  <div class="section-ref"><span>§11.1 · Status</span><span class="rule"></span></div>
  <dl class="manage-dl">
    <dt>Subscriber</dt><dd>${escapeHtml(email ?? deployment.customerId)}</dd>
    <dt>Worker</dt><dd class="mono">${
      // workerUrl is the resolved <name>.<account-subdomain>.workers.dev
      // (or a custom domain). Older rows may not have it — fall back to
      // the legacy <name>.workers.dev display in that case.
      escapeHtml(
        deployment.workerUrl
          ? deployment.workerUrl.replace(/^https?:\/\//, "")
          : `${deployment.workerName}.workers.dev`
      )
    }</dd>
    <dt>Account</dt><dd class="mono">${escapeHtml(deployment.accountId.slice(0, 12))}…</dd>
    <dt>Created</dt><dd class="mono">${escapeHtml(deployment.createdAt)}</dd>
    <dt>Last pushed</dt><dd class="mono">${escapeHtml(lastPushed)}</dd>
    <dt>Build sha</dt><dd class="mono">${escapeHtml(sha)}</dd>
    <dt>Updates</dt><dd>${
      paused
        ? '<span class="pill pill-paused">paused</span>'
        : '<span class="pill pill-active">active</span>'
    }</dd>
    ${lastErr ? `<dt>Last error</dt><dd class="mono small" style="color: var(--accent);">${escapeHtml(lastErr)}</dd>` : ""}
  </dl>
</section>

<section class="reveal cloud-step">
  <div class="section-ref"><span>§11.2 · Actions</span><span class="rule"></span></div>
  <div class="manage-actions">
    <button id="push-now" class="btn primary">Push update now</button>
    <button id="toggle-pause" class="btn ${paused ? "primary" : "ghost"}" data-paused="${paused}">
      ${paused ? "Resume updates" : "Pause updates"}
    </button>
    <button id="rotate-token" class="btn ghost">Rotate Cloudflare token</button>
    <button id="open-portal" class="btn ghost">Manage subscription (Stripe)</button>
  </div>
  <div id="action-out" class="mono small" style="color: var(--muted); margin-top: 12px;"></div>

  <details style="margin-top: 18px;">
    <summary class="mono" style="cursor:pointer; font-size: 11px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase;">Paste a fresh token</summary>
    <p style="font-size: 14px; color: var(--muted); margin-top: 12px;">
      Use this when your previous token expired or you revoked it after a
      suspected leak. The new token replaces the encrypted ciphertext in our
      D1; we never see the previous plaintext.
    </p>
    <div class="field">
      <label for="new-token">Fresh CF API token</label>
      <input id="new-token" type="password" autocomplete="off" placeholder="abcdef…" />
    </div>
    <button id="rotate-submit" class="btn primary">Replace token</button>
  </details>

  <details style="margin-top: 18px;">
    <summary class="mono" style="cursor:pointer; font-size: 11px; letter-spacing: 0.12em; color: var(--accent); text-transform: uppercase;">Forget my deployment</summary>
    <p style="font-size: 14px; color: var(--muted); margin-top: 12px;">
      Permanently deletes our copy of your deployment record (encrypted
      token + push log). <b>Your Worker keeps running</b> in your Cloudflare
      account on whatever version we last pushed; we just stop pushing
      updates and lose the ability to do so.
    </p>
    <p style="font-size: 14px; color: var(--muted); margin-top: 8px;">
      To resubscribe afterwards, complete the Stripe flow again at
      <a href="/pricing">/pricing</a> and redeploy.
    </p>
    <div class="field">
      <label for="forget-confirm">Type <span class="mono">forget</span> to confirm</label>
      <input id="forget-confirm" type="text" autocomplete="off" placeholder="forget" />
    </div>
    <button id="forget-submit" class="btn ghost" style="border-color: var(--accent); color: var(--accent);">Forget my deployment</button>
  </details>
</section>

<section class="reveal cloud-step">
  <div class="section-ref"><span>§11.3 · Audit log</span><span class="rule"></span><span>last 20 events</span></div>
  <div class="audit-table-wrap">
    <table class="audit-table">
      <thead><tr><th>When</th><th>Event</th><th>SHA</th><th>Detail</th></tr></thead>
      <tbody>${logRows || '<tr><td colspan="4" class="mono small" style="color: var(--muted);">no events yet</td></tr>'}</tbody>
    </table>
  </div>
</section>
</main>

<style>
.manage-dl {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 8px 18px;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  padding: 18px 0;
  margin: 18px 0;
}
.manage-dl dt { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.manage-dl dd { margin: 0; font-size: 14px; color: var(--ink); }
.manage-dl dd.small, .small { font-size: 13px; }
.manage-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.pill { display: inline-block; padding: 2px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; border-radius: 999px; border: 1px solid var(--muted-2); }
.pill.pill-active { color: var(--ok, #2d5c3e); border-color: var(--ok, #2d5c3e); }
.pill.pill-paused { color: var(--accent); border-color: var(--accent); }
.field { margin: 12px 0; }
.field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.field input { width: 100%; max-width: 480px; padding: 10px 12px; font-family: 'IBM Plex Mono', monospace; font-size: 14px; border: 1px solid var(--rule); background: transparent; color: var(--ink); }
.audit-table-wrap { overflow-x: auto; border: 1px solid var(--rule); }
.audit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.audit-table th, .audit-table td { text-align: left; padding: 8px 12px; border-bottom: 1px dotted var(--muted-2); vertical-align: top; }
.audit-table th { background: rgba(0,0,0,0.04); font-size: 11px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; font-weight: normal; }
.audit-table tr:last-child td { border-bottom: 0; }
.kind-push-success { color: var(--ok, #2d5c3e); }
.kind-push-failure { color: var(--accent); }
</style>

<script>
(function () {
  const TOKEN = ${JSON.stringify(manageToken)};
  const out = document.getElementById('action-out');
  function say(msg, isErr) {
    out.textContent = msg;
    out.style.color = isErr ? 'var(--accent)' : 'var(--muted)';
  }
  // Token rides in the request BODY, not the URL — keeps it out of CDN
  // access logs even though the page response sets Referrer-Policy: no-referrer.
  async function call(action, extra) {
    const body = Object.assign({ manageToken: TOKEN }, extra || {});
    const r = await fetch('/api/cloud/manage/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await r.json();
  }
  const toggle = document.getElementById('toggle-pause');
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    say('updating…');
    const next = toggle.dataset.paused === 'true' ? 'resume' : 'pause';
    const r = await call(next);
    if (r.ok) {
      say(next === 'pause' ? 'Updates paused. Reload to confirm.' : 'Updates resumed. Reload to confirm.');
      setTimeout(() => location.reload(), 600);
    } else {
      say('error: ' + (r.error || 'unknown'), true);
      toggle.disabled = false;
    }
  });
  document.getElementById('rotate-token').addEventListener('click', () => {
    // Find the "Paste a fresh token" details (first one).
    const all = document.querySelectorAll('details');
    if (all[0]) all[0].open = true;
    const inp = document.getElementById('new-token');
    if (inp) inp.focus();
  });
  document.getElementById('rotate-submit').addEventListener('click', async () => {
    const t = document.getElementById('new-token').value.trim();
    if (!t) { say('paste a token first', true); return; }
    say('rotating…');
    const r = await call('rotate-token', { cfToken: t });
    if (r.ok) {
      document.getElementById('new-token').value = '';
      say('token replaced. The next push will use it.');
    } else {
      say('rotate failed: ' + (r.error || 'unknown'), true);
    }
  });
  document.getElementById('open-portal').addEventListener('click', async () => {
    say('opening Stripe portal…');
    const r = await call('billing-portal');
    if (r.ok && r.url) { location.href = r.url; }
    else { say('portal error: ' + (r.error || 'unknown'), true); }
  });
  // Push now — fetches the latest manifest + uploads to the customer's
  // Worker out-of-band from the hourly cron. The button stays disabled
  // until the request resolves so a double-click can't fire two parallel
  // pushes.
  //
  // Self-managed gate: if the live Worker has HELM_CUSTOM_DEPLOY set
  // (customer is deploying their own fork via Artifacts), the server
  // returns 409 with selfManaged:true. We confirm() with the user before
  // re-calling with confirm:true to override.
  const pushBtn = document.getElementById('push-now');
  if (pushBtn) {
    pushBtn.addEventListener('click', async () => {
      pushBtn.disabled = true;
      say('pushing latest bundle…');
      try {
        let r = await call('push-now');
        if (!r.ok && r.selfManaged) {
          const proceed = window.confirm(
            'This deployment is self-managed via Artifacts. ' +
            'Pushing upstream will OVERWRITE your custom code with the latest open-think release. ' +
            'Are you sure you want to continue?'
          );
          if (!proceed) {
            say('cancelled — your custom deploy is untouched.');
            return;
          }
          say('confirmed — pushing upstream over custom code…');
          r = await call('push-now', { confirm: true });
        }
        if (r.ok && r.alreadyUpToDate) {
          say(r.message || 'Already on the latest bundle.');
        } else if (r.ok) {
          say((r.message || 'Pushed.') + ' Reload to see the new build sha.');
          // Give the CF API a moment to settle before reloading so the
          // page reflects the new last_pushed_at + audit-log row.
          setTimeout(() => location.reload(), 1500);
        } else {
          say('push failed: ' + (r.error || 'unknown'), true);
        }
      } catch (err) {
        say('push failed: ' + ((err && err.message) || 'network error'), true);
      } finally {
        pushBtn.disabled = false;
      }
    });
  }
  // Forget my deployment — typed-confirmation gate so a misclick can't trigger it.
  const forgetBtn = document.getElementById('forget-submit');
  if (forgetBtn) {
    forgetBtn.addEventListener('click', async () => {
      const confirmInput = document.getElementById('forget-confirm');
      const word = (confirmInput.value || '').trim().toLowerCase();
      if (word !== 'forget') {
        say('type "forget" in the confirmation box to proceed', true);
        return;
      }
      forgetBtn.disabled = true;
      say('forgetting…');
      const r = await call('forget');
      if (r.ok) {
        say('Done. Your deployment record is gone. The Worker still runs in your account.');
        // Replace the manage page with a finality message so further
        // clicks don't 404 confusingly.
        setTimeout(() => {
          document.body.innerHTML =
            '<main style="padding:80px 24px;max-width:640px;margin:0 auto;font-family:Instrument Serif,serif;">' +
            '<h1 style="font-size:48px;line-height:1.05;">Forgotten.</h1>' +
            '<p style="font-family:IBM Plex Sans,sans-serif;color:#666;margin-top:18px;">' +
            'Your deployment record has been deleted. Your Worker is still running in your Cloudflare account on the version we last pushed. ' +
            'To resubscribe, visit <a href="/pricing" style="color:#f38020;">pricing</a>.' +
            '</p></main>';
        }, 1200);
      } else {
        say('forget failed: ' + (r.error || 'unknown'), true);
        forgetBtn.disabled = false;
      }
    });
  }
})();
</script>

${htmlFoot()}`;
}

function kindClass(kind: string): string {
  if (kind === "push-success") return "kind-push-success";
  if (kind === "push-failure") return "kind-push-failure";
  return "";
}

/* ---------------- not-found / expired-token shell ---------------- */

export function renderManageNotFound(reason: string): string {
  return `${htmlHead({ title: "Manage link unavailable" })}
<main>
<section style="padding-top: 48px;">
  <div class="section-ref"><span>§11 · Manage link unavailable</span><span class="rule"></span></div>
  <h1 class="serif" style="font-size: clamp(40px, 6vw, 64px); max-width: 22ch;">
    This <em>manage link</em> isn't valid.
  </h1>
  <p class="sub" style="max-width: 60ch;">
    ${escapeHtml(reason)}
  </p>
  <p style="margin-top: 24px;">
    <a class="btn primary" href="/deploy/cloud">Back to Cloud Deploy</a>
  </p>
</section>
</main>
${htmlFoot()}`;
}
