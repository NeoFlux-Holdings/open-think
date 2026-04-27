import { htmlHead, htmlFoot } from "../layout";

export function renderConcierge(): string {
  return `${htmlHead({
    title: "Concierge",
    description:
      "Book a 90-minute live session. We wire your Cloudflare account, bindings, provider keys, and MCP — you walk away with a working Helm."
  })}
<main>

<section class="hero" style="padding-top: 48px; grid-template-columns: 1.3fr 1fr;">
  <div class="reveal d1">
    <div class="edition mono">§04 · Concierge · 90 minutes</div>
    <h1 class="serif">
      We set it up <em>with</em> you.<br>Live.
    </h1>
    <p class="sub">
      Ninety minutes, over video. By the end you have a Helm running against your
      own Cloudflare account, your provider keys wired, your MCP bridge connected, and
      a recording you can refer back to.
    </p>
    <p style="color: var(--muted); font-size: 15px; max-width: 52ch;">
      Bring: Cloudflare account, any provider keys you want to use (Anthropic, OpenAI, Groq, etc.), and a rough idea of the first agent you want to ship. We handle the rest.
    </p>
    <div class="actions" style="margin-top: 28px;">
      <form method="POST" action="/api/stripe/checkout" style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
        <input type="hidden" name="plan" value="concierge" />
        <input type="email" name="email" placeholder="you@example.com" required style="border: 1px solid var(--rule); padding: 12px 14px; font-family: 'IBM Plex Sans', sans-serif; background: transparent; color: var(--ink); min-width: 260px;" />
        <button class="btn primary" type="submit">Book for $499 <span class="arrow">→</span></button>
      </form>
    </div>
  </div>

  <div class="reveal d2">
    <div class="section-ref"><span>What we cover</span><span class="rule"></span></div>
    <ul style="list-style: none; padding: 0;">
      <li style="padding: 14px 0; border-bottom: 1px solid var(--muted-2); font-size: 15px;"><span class="mono accent" style="font-size: 11px; display: block; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 3px;">00:00 — 00:15</span>Account audit: bindings, existing workers, DNS, zones</li>
      <li style="padding: 14px 0; border-bottom: 1px solid var(--muted-2); font-size: 15px;"><span class="mono accent" style="font-size: 11px; display: block; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 3px;">00:15 — 00:30</span>Deploy Open Think, confirm health + routes</li>
      <li style="padding: 14px 0; border-bottom: 1px solid var(--muted-2); font-size: 15px;"><span class="mono accent" style="font-size: 11px; display: block; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 3px;">00:30 — 00:50</span>Wire providers: Anthropic / OpenAI / CF AI Gateway</li>
      <li style="padding: 14px 0; border-bottom: 1px solid var(--muted-2); font-size: 15px;"><span class="mono accent" style="font-size: 11px; display: block; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 3px;">00:50 — 01:10</span>Connect MCP (Cloudflare + any custom)</li>
      <li style="padding: 14px 0; border-bottom: 1px solid var(--muted-2); font-size: 15px;"><span class="mono accent" style="font-size: 11px; display: block; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 3px;">01:10 — 01:25</span>First agent: your use case, built live</li>
      <li style="padding: 14px 0; font-size: 15px;"><span class="mono accent" style="font-size: 11px; display: block; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 3px;">01:25 — 01:30</span>Handoff + 30-day follow-up inbox</li>
    </ul>
  </div>
</section>

<section class="reveal d3">
  <div class="section-ref"><span>§04.1 · What you keep</span><span class="rule"></span></div>
  <div class="grid-3">
    <div class="pillar">
      <span class="n mono">§04.1.1</span>
      <h3 class="serif">A running Helm</h3>
      <p>On your Cloudflare account, on your domain, wired to the providers you pay for. No lock-in. No hidden dependencies.</p>
    </div>
    <div class="pillar">
      <span class="n mono">§04.1.2</span>
      <h3 class="serif">A private recording</h3>
      <p>Full session, chaptered, delivered within 24 hours. Refer back to every step we took.</p>
    </div>
    <div class="pillar">
      <span class="n mono">§04.1.3</span>
      <h3 class="serif">30 days of inbox</h3>
      <p>Email us anything that breaks in the first month. Response within one business day. If it's our fault, we fix it.</p>
    </div>
  </div>
</section>

</main>
${htmlFoot()}`;
}
