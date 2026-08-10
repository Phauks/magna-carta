---
category: Added
---

**Research: is Cloudflare's Kitesurf browser worth adopting, and where would it ride?** An assessment
of Kitesurf — announced 2026-08-06 as part of Agents Week — written from the Browser Run product
documentation rather than the announcement, and mapped onto the one browser consumer we ship (the Safe
Website Viewer) and the one we have designed and not built (the email-to-PDF render stage). Kitesurf is
not a product or a library: it is **an alternate browser engine, written from scratch in Rust and
running in Workers V8 isolates, selectable on the existing Browser Run service** by appending
`browser=kitesurf` to an endpoint. The recommendation is **adopt later** — and, unusually, with
**nothing to build in the meantime**, because ADR-0119 already left `BrowserRenderer` as an injected
port and a second adapter is a day's work whenever the triggers fire.

Three findings carry it. **The cost claim does not survive the pricing page** — the blog says Kitesurf
"wins on the memory and CPU that drive your bill", but Browser Run bills browser _hours_ and concurrent
browsers, and Kitesurf's own table puts it at 1.7–1.8× slower in wall time, so on the published meter it
is roughly twice as expensive per render once the free beta ends. **The confidentiality answer is
favourable and structural** — Browser Run is Cloudflare, the same trust boundary as Workers, D1, R2 and
Workers AI, so this is in-platform processing that does not trigger ADR-0109's consent gate, and the FAQ
states content is processed ephemerally with exactly two retention exceptions (`/crawl` results held 14
days, opt-in session recording held 30) that we neither use nor should. **And the two things Kitesurf
cannot do are the two the shipped consumer needs** — it cannot negotiate a bot-challenge TLS handshake
and does not render pixel-perfectly, which is precisely wrong for a tool whose job is showing a user
what a suspicious link really looks like.

Records the golden-rule-14 inversion worth having on file: Kitesurf drags no C or C++ into our
dependency graph because it drags nothing in at all — it is a service, not a library — yet it is the
best answer we have to the rule's underlying reasoning, replacing C++ Blink with safe Rust in the one
place where the bytes being parsed are chosen by an adversary on purpose. Ranks seven candidate uses
(two real, one real-but-later, three stretches, one refusal — rendering our own invoices, which is what
the marketing points at and fits us worst), names six revisit triggers including binding parity and a
published post-beta price, notes two pre-existing gaps found along the way (the Browser Rendering to
Browser Run rename still in ADR-0119 and the safe-browse files, and Browser Run having no row in the
operating-cost register despite shipping), and closes with eleven things not to conclude. Research only
— no decision, no ADR, no code, nothing adopted.
