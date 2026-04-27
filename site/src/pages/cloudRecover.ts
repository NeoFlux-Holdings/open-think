import { htmlHead, htmlFoot } from "../layout";

/**
 * /cloud/recover — last-resort path for a Helm Cloud subscriber who lost
 * their manage URL.
 *
 * UX:
 *   1. Tells them what happened (you paid, you got a URL, you lost it).
 *   2. Direct mailto to support — the fast path, since support can issue
 *      a fresh token via SQL in seconds.
 *   3. Optional form that records the request via a console.warn for
 *      Cloudflare Workers Tail to pick up. Even without inbound email
 *      monitoring, support sees these by tailing logs.
 */
export function renderCloudRecover(params: { submitted?: boolean; supportEmail?: string } = {}): string {
  const support = params.supportEmail ?? "hello@open-think.app";
  const submitted = params.submitted === true;
  return `${htmlHead({
    title: "Recover your manage link",
    description:
      "Lost the manage URL we sent you after Helm Cloud subscription? Email support and we'll re-issue one within a business day."
  })}
<main>
<section style="padding-top: 36px;">
  <div class="edition mono">§12 · Helm Cloud · recover</div>
  <h1 class="serif" style="font-size: clamp(40px, 6vw, 64px); max-width: 22ch;">
    Lost the <em>manage link</em>?
  </h1>
  <p class="sub" style="max-width: 60ch;">
    We only show the manage URL once — right after your deploy. We don't
    store it anywhere we can email it from. The fastest fix is a quick
    note to support; we'll re-issue a fresh URL within a business day.
  </p>
</section>

<section style="margin-top: 36px;">
  <div class="section-ref"><span>§12.1 · Email support</span><span class="rule"></span><span>fastest</span></div>
  <p>
    Send a one-line email — we just need to confirm it's the same address
    that paid for your subscription:
  </p>
  <p style="margin-top: 18px;">
    <a class="btn primary" href="mailto:${support}?subject=Helm%20Cloud%20manage%20link%20lost">
      Email ${support} <span class="arrow">↗</span>
    </a>
  </p>
</section>

<section style="margin-top: 36px;">
  <div class="section-ref"><span>§12.2 · Or leave a request here</span><span class="rule"></span><span>same-day response</span></div>
  ${
    submitted
      ? `<div class="notice"><b>Got it</b>We logged your request. A human will reach out within one business day. If you don't hear back, email <a href="mailto:${support}">${support}</a> directly.</div>`
      : `<form method="POST" action="/api/cloud/recover" class="field" style="margin-bottom: 0;">
          <label for="recover-email">Email used for your subscription</label>
          <input id="recover-email" type="email" name="email" placeholder="you@example.com" required style="margin-bottom: 14px;" />
          <label for="recover-note">Anything we should know? <span style="color: var(--muted); font-size: 12px;">(optional)</span></label>
          <input id="recover-note" type="text" name="note" placeholder="e.g. closed the tab right after deploy" style="margin-bottom: 18px;" />
          <button class="btn primary" type="submit">Request a new manage link →</button>
        </form>`
  }
</section>

<section style="margin-top: 48px;">
  <div class="section-ref"><span>§12.3 · Meanwhile</span><span class="rule"></span></div>
  <p>
    Your Worker is still running in your Cloudflare account on whatever
    version we last pushed. Helm Cloud only handles deploy pipeline — the
    runtime is independent. Pause / cancellation can also be done via
    your Stripe portal directly (search your inbox for the original
    receipt; the portal link is in there).
  </p>
</section>
</main>
${htmlFoot()}`;
}
