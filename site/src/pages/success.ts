import { htmlHead, htmlFoot } from "../layout";

export function renderSuccess(sessionId?: string): string {
  return `${htmlHead({
    title: "Thank you",
    description: "Payment received. Check your email for the next steps."
  })}
<main>

<section class="hero" style="grid-template-columns: 1fr; text-align: center; padding-top: 96px;">
  <div class="reveal d1" style="max-width: 720px; margin: 0 auto;">
    <div class="edition mono">§06 · Confirmed · payment received</div>
    <h1 class="serif" style="font-size: clamp(56px, 9vw, 120px);">
      Thank <em>you</em>.
    </h1>
    <p class="sub" style="margin: 0 auto 28px; max-width: 48ch;">
      We've sent a receipt + the next steps to your email. For concierge bookings, expect
      a scheduling email from us within one business day.
    </p>
    <div class="actions" style="justify-content: center;">
      <a href="/" class="btn">Back to home</a>
      <a href="/docs" class="btn ghost">Read the docs</a>
    </div>
    ${
      sessionId
        ? `<p class="mono" style="font-size: 11px; letter-spacing: 0.12em; color: var(--muted); margin-top: 40px;">reference · ${sessionId}</p>`
        : ""
    }
  </div>
</section>

</main>
${htmlFoot()}`;
}
