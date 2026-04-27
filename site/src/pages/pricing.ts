import { htmlHead, htmlFoot } from "../layout";

export interface PricingConfig {
  /** True when STRIPE_PRICE_PRO_MONTHLY is set on the Worker. */
  hasPro?: boolean;
  /** True when STRIPE_PRICE_CONCIERGE_ONESHOT is set. */
  hasConcierge?: boolean;
  /** True when STRIPE_PRICE_HELM_CLOUD is set. */
  hasHelmCloud?: boolean;
}

export function renderPricing(
  params: { cancelled?: boolean; config?: PricingConfig } = {}
): string {
  const cfg = params.config ?? {};
  const buttonOrComingSoon = (
    enabled: boolean,
    formHtml: string,
    label: string
  ): string => {
    if (enabled) return formHtml;
    return `<div class="plan-coming-soon">
      <div class="mono">${label}</div>
      <p style="font-size: 12px; color: var(--muted); margin: 8px 0 0;">
        Set the matching <span class="mono">STRIPE_PRICE_*</span> secret to enable.
        See the <a href="/docs/helm-cloud-runbook">runbook</a>.
      </p>
    </div>`;
  };

  return `${htmlHead({
    title: "Pricing",
    description:
      "Open Think is Apache-2.0 and free to run on your own Cloudflare account. Pro gives you a managed instance, priority support, and a guided concierge. Concierge gets you a live 90-minute setup session."
  })}
<main>

<section class="hero" style="padding-top: 48px; grid-template-columns: 1fr; text-align: left;">
  <div class="reveal d1">
    <div class="edition mono">§03 · Pricing · effective 2026-04</div>
    <h1 class="serif" style="font-size: clamp(44px, 7vw, 92px); max-width: 18ch;">
      <em>Free</em> to run. Pro when you need hands.
    </h1>
    <p class="sub" style="max-width: 58ch;">
      Open Think is Apache-2.0 and community-driven — deploy it to your own Cloudflare
      account for $0. The tiers below are for teams who want us to operate it for them,
      or want a human in the room for the first hour.
    </p>
    ${
      params.cancelled
        ? `<div class="notice"><b>Checkout cancelled</b>No charge was made. Pick a plan whenever you're ready.</div>`
        : ""
    }
  </div>
</section>

<section class="reveal d2" style="padding-top: 16px;">
  <div class="plans plans-4">
    <div class="plan">
      <div class="name">Community</div>
      <div class="price serif">$0<small>/forever</small></div>
      <div class="tagline">Self-hosted · Apache-2.0 · fully open source.</div>
      <ul>
        <li>Deploy to your own Cloudflare account</li>
        <li>Every plugin, every provider, every skill</li>
        <li>Helm meta-agent (3 modes)</li>
        <li>GitHub issues + discussions</li>
        <li>You operate it, we merge your PRs</li>
        <li class="minus">No managed hosting</li>
        <li class="minus">No SLA / no priority inbox</li>
      </ul>
      <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/NeoFlux-Holdings/open-think" class="btn cta">Deploy to Cloudflare <span class="arrow">→</span></a>
    </div>

    <div class="plan featured">
      <div class="name">Helm Cloud</div>
      <div class="price serif">$9<small>/mo</small></div>
      <div class="tagline">Managed pushes · runs in <em>your</em> Cloudflare.</div>
      <ul>
        <li>Three-minute browser deploy, no terminal</li>
        <li>Worker runs in <b>your</b> CF account</li>
        <li>Your D1, your DOs, your secrets — never crosses us</li>
        <li>We push new releases on a schedule</li>
        <li>Pause, rotate token, or cancel anytime</li>
        <li>Cancel → the Worker keeps running</li>
      </ul>
      ${buttonOrComingSoon(
        Boolean(cfg.hasHelmCloud),
        `<form method="POST" action="/api/stripe/checkout" class="field" style="margin-bottom: 0;">
        <input type="hidden" name="plan" value="helm-cloud" />
        <label for="email-cloud">Email</label>
        <input id="email-cloud" type="email" name="email" placeholder="you@example.com" required style="margin-bottom: 14px;" />
        <button class="btn primary cta" type="submit">Start Helm Cloud →</button>
      </form>`,
        "Coming soon"
      )}
    </div>

    <div class="plan">
      <div class="name">Pro</div>
      <div class="price serif">$29<small>/mo</small></div>
      <div class="tagline">Managed instance · on our infrastructure.</div>
      <ul>
        <li>Everything in Community, managed for you</li>
        <li>Subdomain at <span class="mono">&lt;you&gt;.open-think.app</span></li>
        <li>Priority support in 1 business day</li>
        <li>Early access to new plugins</li>
        <li>Audit log + backup retention</li>
        <li>Annual plan saves two months</li>
      </ul>
      ${buttonOrComingSoon(
        Boolean(cfg.hasPro),
        `<form method="POST" action="/api/stripe/checkout" class="field" style="margin-bottom: 0;">
        <input type="hidden" name="plan" value="pro-monthly" />
        <label for="email-pro">Email for receipts</label>
        <input id="email-pro" type="email" name="email" placeholder="you@example.com" required style="margin-bottom: 14px;" />
        <button class="btn cta" type="submit">Start Pro →</button>
      </form>`,
        "Coming soon"
      )}
    </div>

    <div class="plan">
      <div class="name">Concierge</div>
      <div class="price serif">$499<small>/one-shot</small></div>
      <div class="tagline">90 minutes, we set it up live with you.</div>
      <ul>
        <li>Scheduled 90-minute working session</li>
        <li>We wire your Cloudflare account + bindings</li>
        <li>We hook up Anthropic / OpenAI / your subscription</li>
        <li>You walk away with a working Helm</li>
        <li>Recording + 30-day follow-up inbox</li>
        <li>One-time charge, no subscription</li>
      </ul>
      ${buttonOrComingSoon(
        Boolean(cfg.hasConcierge),
        `<form method="POST" action="/api/stripe/checkout" class="field" style="margin-bottom: 0;">
        <input type="hidden" name="plan" value="concierge" />
        <label for="email-concierge">Email</label>
        <input id="email-concierge" type="email" name="email" placeholder="you@example.com" required style="margin-bottom: 14px;" />
        <button class="btn cta" type="submit">Book concierge →</button>
      </form>`,
        "Coming soon"
      )}
    </div>
  </div>

  <p class="mono" style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-top: 28px; text-align: center;">
    Annual Pro · <a href="/pricing?cycle=annual">save two months</a> · billed once yearly · $290
  </p>
</section>

<style>
  .plan-coming-soon {
    border: 1px dashed var(--muted-2);
    padding: 14px 16px;
    text-align: center;
    background: var(--shade);
  }
  .plan-coming-soon .mono {
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  /* 4-card pricing override — wider grid on desktop, 2×2 on tablet, stack on phone. */
  .plans.plans-4 {
    grid-template-columns: repeat(4, 1fr);
  }
  @media (max-width: 1180px) {
    .plans.plans-4 {
      grid-template-columns: repeat(2, 1fr);
    }
    .plans.plans-4 .plan {
      border-right: none;
    }
    .plans.plans-4 .plan:nth-child(2n) {
      border-right: 1px solid var(--rule); /* visual lie — actually a left for the next col */
    }
    .plans.plans-4 .plan:nth-child(odd) {
      border-right: 1px solid var(--rule);
    }
    .plans.plans-4 .plan:nth-child(-n+2) {
      border-bottom: 1px solid var(--rule);
    }
  }
  @media (max-width: 900px) {
    .plans.plans-4 {
      grid-template-columns: 1fr;
    }
    .plans.plans-4 .plan {
      border-right: none;
      border-bottom: 1px solid var(--rule);
    }
    .plans.plans-4 .plan:last-child {
      border-bottom: none;
    }
  }
</style>

<section class="reveal d3">
  <div class="section-ref"><span>§03.1 · FAQ</span><span class="rule"></span></div>
  <div class="grid-2">
    <div>
      <h3 class="serif">What's the difference between Pro and Helm Cloud?</h3>
      <p>
        <b>Pro</b> runs your agent on <em>our</em> Cloudflare account, at
        <span class="mono">&lt;you&gt;.open-think.app</span>. We pay the
        Cloudflare bill, you pay us $29/mo.
      </p>
      <p>
        <b>Helm Cloud</b> runs your agent in <em>your</em> Cloudflare
        account. Your data, your bindings, your billing — we just push code
        updates on a schedule using a narrow encrypted token. $9/mo because
        we're not carrying your runtime; you are.
      </p>
      <p>
        Pick Pro if you want hands-off and don't care about cloud accounts.
        Pick Helm Cloud if you want privacy + ownership but still want
        someone to handle releases.
      </p>
    </div>
    <div>
      <h3 class="serif">Do you charge per run?</h3>
      <p>No. Both Pro and Helm Cloud are flat monthly fees. Your Cloudflare account pays for actual compute (Workers AI, Durable Objects, egress) at Cloudflare's rates — we don't mark anything up. Helm Cloud is just the deploy pipeline.</p>
    </div>
    <div>
      <h3 class="serif">Can Helm Cloud see my prompts or data?</h3>
      <p>
        No. The Worker runs in your Cloudflare isolate against your
        bindings. We hold one encrypted, narrowly-scoped Cloudflare API token
        (Workers Scripts:Edit, D1:Edit, Access:Edit) which we use only to
        push updates. We never read your D1, never see your prompts, never
        proxy your traffic. Revoke the token at
        <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">dash → API Tokens</a>
        any time and your Worker keeps running on the version we last pushed.
      </p>
    </div>
    <div>
      <h3 class="serif">What happens when I cancel?</h3>
      <p>
        <b>Helm Cloud:</b> Stripe cancels at period end; the cron stops
        pushing; your Worker keeps running on the version we last pushed.
        You keep everything.
      </p>
      <p>
        <b>Pro:</b> Your managed instance stays available through the end
        of the billing period, then we export to a GitHub repo you own and
        hand it over. Same code, your account.
      </p>
    </div>
    <div>
      <h3 class="serif">Can I self-host forever and still buy concierge?</h3>
      <p>Yes. Concierge is a one-time session and works regardless of where your runtime lives. Most people buy it the week they decide to ship.</p>
    </div>
    <div>
      <h3 class="serif">Refunds?</h3>
      <p>Within 14 days of signing up, for any reason, full refund. Concierge is refundable if we haven't run the session yet.</p>
    </div>
  </div>
</section>

</main>
${htmlFoot()}`;
}
