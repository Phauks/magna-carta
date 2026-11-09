# Cloudflare Kitesurf — assessment against this platform

**Date:** 2026-08-10
**Scope:** What Cloudflare shipped on 2026-08-06 under the name Kitesurf, read from the product
documentation rather than the announcement, and an honest fit assessment against the one Browser
Rendering consumer we already ship (the Safe Website Viewer), the one we have designed and not built
(email to PDF), and the several places somebody could plausibly reach for it.
**Prompted by:** the owner's question — _"how can we leverage this product"_ — with one link,
[`blog.cloudflare.com/kitesurf`](https://blog.cloudflare.com/kitesurf/).
**Purpose:** This is **research, not a spec and not a decision.** Nothing here is built or committed.
The binding decisions in this area are already recorded — ADR-0119 (the Safe Website Viewer's static
snapshot and its streaming seam), ADR-0128 and ADR-0162 (the pure-Rust PDF engine), ADR-0204 (the
LibreOffice engine and its refusal to publish an HTML source format), ADR-0003 (tenancy), and
ADR-0109 through ADR-0113 (AI and inference) — and nothing here changes any of them.

**Method.** The blog post was read in full as raw Markdown. Every load-bearing claim was then checked
against the product documentation: the `browser-run` section index (`llms.txt`, 40 pages), the
Kitesurf page, the pricing page, the limits page, the FAQ's Security and Data Handling section, the
Wrangler bindings reference, the automatic-request-headers reference, the `/pdf` and `/json` Quick
Action pages, the REST API reference for `/pdf`, and the 2026-08-06 changelog entry. Where the blog
and the documentation disagree, the documentation is quoted and the disagreement is called out.

---

## 1. Summary — the recommendation, stated plainly

**Recommendation: ADOPT LATER.** Not now, and — the part worth saying out loud — **there is nothing to
build in the meantime.** The swappable boundary this product would ride is already in the codebase:
`SafeBrowseDeps.renderer` is an injected port, `createBrowserRenderer()` is one adapter behind it, and
adding a second is a day's work whenever the triggers in section 8 fire. A prior design already did
the work that "build the seam only" would otherwise ask for.

Three findings carry that conclusion.

**First, the cost claim in the announcement does not survive the pricing page.** The blog says
Kitesurf "wins on the memory and CPU that drive your bill (by 3–7×)". Browser Run does not bill CPU or
memory. It bills **browser hours** and **concurrent browsers** — `$0.09` per browser hour past ten,
`$2.00` per concurrent browser past ten. Both are wall-clock meters, and Kitesurf's own comparison
table puts it at **1.7–1.8× slower in wall time** than Chromium. On the published price list, once the
free beta ends, Kitesurf is not cheaper per render — it is roughly **twice as expensive**. The docs win
over the blog here, and this is the single most important thing to re-verify at general availability.

**Second, the confidentiality answer is favourable, and for a structural reason.** Browser Run is
Cloudflare, the same trust boundary as Workers, D1, R2 and Workers AI. No outside party sees the bytes,
so this sits on the **in-platform** side of the line, not the third-party side, and ADR-0109's consent
gate is not triggered by rendering as such. The documentation is explicit that content is processed
ephemerally and discarded, with exactly two named exceptions — neither of which we use or should. And
Kitesurf specifically **improves** the posture golden rule 14 exists to protect: the engine that parses
a hostile page stops being C++ Blink and becomes safe Rust.

**Third, the two things Kitesurf cannot do are precisely the two things our shipped consumer needs.**
The Safe Website Viewer exists to tell a user what a suspicious link leads to. Kitesurf, by its own
documentation, cannot "negotiate a bot-challenge handshake with real TLS fingerprints" and does not
render pixel-perfectly. Phishing and cloaking pages are the population most likely to sit behind a
challenge, and a screenshot that misrenders is a hygiene tool quietly telling a small lie. The
capability gap lands on the exact use case, not somewhere adjacent to it.

---

## 2. What it actually is

Kitesurf is **a web browser engine Cloudflare wrote from scratch in Rust, compiled to WebAssembly,
that runs inside Workers V8 isolates instead of on a machine.** It is not a product you install, a
library you depend on, or a service with its own SKU: it is an **alternate engine selectable on the
existing Browser Run service** by appending `browser=kitesurf` to an endpoint URL. Everything else —
authentication, the Quick Actions, the Chrome DevTools Protocol endpoint, Puppeteer and Playwright
compatibility, the limits, the billing meter — is Browser Run's and is unchanged.

Its architecture, from the announcement:

- **Engine** — the only public-facing component. Owns the CDP WebSocket and the HTTP REST surface, and
  holds session state. Everything else is stateless.
- **PageScript** — one isolate per page or out-of-process iframe, with a clean `globalThis` and a DOM.
  HTML and CSS parsing use [Blitz](https://github.com/DioxusLabs/blitz) and
  [Stylo](https://github.com/servo/stylo) (Firefox's CSS engine), both Rust. Page scripts run in that
  same isolate. `eval` is not supported natively in Workers, so it is handled by
  [Boa](https://boajs.dev/), an ECMAScript engine written in Rust — the blog's own phrasing is "a
  runtime on top of a runtime, which doesn't seem optimal, and it isn't, but it works well enough".
- **PageRenderer** — rasterizes to PNG, JPEG or PDF via `blitz-paint` and Parley. Holds no page state,
  so the Engine can kill and relaunch it on any stuck call.
- **SandboxOutbound** — the single component permitted to touch the network, enforced by Dynamic
  Workers. It enforces CORS, injects browser-shaped headers, filters responses, and keeps each page's
  cookies in their own jar. Note the direction of that isolation: it protects the platform from the
  page, and it exists **to fetch arbitrary assets from the open Internet**. It is not a switch for
  refusing to fetch anything. That matters in section 5.2.

**Status: beta, and Cloudflare says so in three places.** The blog: "available for free while in
beta"; the Kitesurf documentation page carries a Pricing callout saying "Kitesurf is in beta and
available for free, behind per-account limits"; the changelog entry repeats it. The blog also states
plainly that the roadmap runs "on the road to making Kitesurf **production-ready**" — their words,
present tense. First commit was May 2026; the post describes the project as twelve weeks old.

**Where blog and docs disagree.** Three places, all resolved in the documentation's favour:

| Blog                                                 | Documentation                                                                                                                                   | Resolution                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "passes 215,000+ WPT tests"                          | "passes over **235,000 subtests**", with a per-area table (DOM 97%, HTML 96%, Selection 99%, SVG 97%, Encoding 99%, CORS 95%, XHR 95%, URL 83%) | Docs, and the docs also add the caveat that "WPT measures conformance to web standards, not a browser's ability to render every real-world website" |
| "wins on the memory and CPU that drive your bill"    | Pricing bills **browser hours** and **concurrent browsers**; neither is CPU or memory                                                           | Docs. See section 6                                                                                                                                 |
| "behind per-account limits", linking the limits page | The limits page (last updated 2026-05-20, before launch) contains **no Kitesurf-specific limit at all**                                         | Neither. The per-account Kitesurf limit is undocumented; assume the generic Browser Run limits and verify before relying                            |

**Related in the same wave.** Kitesurf was one of the Agents Week 2026 announcements, alongside Agent
Memory, Sandboxes going generally available, Cloudflare Mesh, and WebMCP. The Agents platform from that
same family was assessed here on 2026-08-04 and Browser Run appears in that document's defer list;
this assessment is the follow-up that list implied.

---

## 3. What problem it solves that we solve another way

Exactly one thing in this repository renders a web page today, and it is the **Safe Website Viewer**
(ADR-0119, spec `docs/specs/2026-06-22-whois-and-safe-website-viewer-design.md`). It takes a URL a user
does not trust, renders it remotely, and hands back only inert data — a screenshot, extracted
text/Markdown, the page title, outbound links, and a redirect chain from a separately guarded probe.
The live page never loads in the user's browser, and that non-interactivity is the safety property.

It is wired as follows: `apps/worker/src/routes/tools/safe-browse.ts` builds a `BrowserRenderer` from the
`env.BROWSER` Workers binding and calls `quickAction("snapshot", { url, formats: ["screenshot",
"markdown"] })` plus a best-effort `quickAction("links", { url })`. The binding is declared in
`apps/worker/wrangler.jsonc` as `"browser": { "binding": "BROWSER" }`. The orchestration lives in
`packages/safe-browse`, behind an injected `SafeBrowseDeps` so tests never touch the binding.

So Kitesurf does not solve a problem we have not solved. It offers a **different engine underneath a
path we already run**, and — as an unbuilt possibility — an HTML layout engine for a rendering stage
we have designed and deliberately left open (section 5.2).

One incidental finding, independent of Kitesurf and worth fixing whoever gets there first: the product
has been **renamed from Browser Rendering to Browser Run**, and the repository still says the old name
in ADR-0119, in `packages/safe-browse/CLAUDE.md`, and in the comments in
`apps/worker/src/routes/tools/safe-browse.ts`. Cloudflare's own documentation is mid-rename too — the
Kitesurf page uses `/browser-run/screenshot` URLs while the limits page still shows
`/browser-rendering/content`.

---

## 4. Where it would ride our architecture

**The seam is `BrowserRenderer`, and it already exists.** `packages/safe-browse/src/types.ts` defines
the port; `createBrowserRenderer(browser)` in the worker route is its only adapter. A Kitesurf adapter
is a sibling implementation of one method. This is what "build the seam only" would have produced, and
ADR-0119 produced it in June for unrelated reasons — the same injected-dependency discipline that lets
the tests run without the binding is what makes the engine swappable.

**But adopting Kitesurf today would break the property ADR-0119 specifically bought.** That ADR records
the `env.BROWSER` binding as a deliberate choice, called out twice: "a Workers binding — no API token
required", and in the consequences, "the `env.BROWSER` binding is sufficient and requires no API
token". Kitesurf selection is documented **only** as a query parameter on `api.cloudflare.com`
endpoints — the changelog, the Kitesurf page, and the blog all show the same `?browser=kitesurf` on a
REST URL or a `wss://` CDP URL. The Wrangler bindings reference documents `quickAction()` and says
nothing about engine selection, and nothing in the Browser Run documentation shows a Kitesurf option
through the binding. Until that parity exists, switching engines means switching from an
in-network binding call to an authenticated public-API call with an API token to store, rotate and
scope. That is a worse posture traded for a beta engine, and it is the concrete reason the answer is
"later" rather than "now".

Nothing else in the stack is touched. Not D1 (no schema), not R2 (screenshots are transient by
ADR-0119 and are not persisted), not Queues, not Durable Objects, not Vectorize, not KV, not the
Containers roster, not Better Auth. The AI Gateway seam and Magnus are untouched — with one carve-out:
the `/json` Quick Action performs its extraction with **Workers AI** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`
by default). That is an inference call made by a rendering endpoint, outside `@magna-carta/inference`
and outside the AI Gateway control plane ADR-0113 pins. **Do not use `/json`.** If structured
extraction from a page is ever wanted, take the Markdown from `/snapshot` and put the model call
through our own chokepoint where the gateway, the catalog, the per-firm consent check and the
`token_usage_meter` row all apply.

---

## 5. Candidate uses, ranked

Enumerated because the question was "how can we leverage this". Two are real, one is real-but-later,
three are stretches, and one is a refusal.

### 5.1 Swap the Safe Website Viewer's render engine — real, but gated

**The case for.** The tool's whole job is pointing a browser at content chosen by an adversary. Today
that content is parsed by Chromium — several million lines of C++, and the largest memory-unsafe
attack surface anywhere in our dependency graph, even though it is Cloudflare's process and not ours.
Kitesurf replaces it with Blitz, Stylo, Parley and Boa, all Rust. Golden rule 14's whole argument is
that memory-unsafe code parsing untrusted bytes is a confidentiality risk even inside a sandbox. This
is that argument, applied to the one place in the platform where the bytes are chosen by an attacker
on purpose. It is the most genuinely attractive thing about this product for us.

**The case against, and it is decisive today.** Three items:

1. **Bot challenges.** The Kitesurf page lists, under what it cannot do yet, "negotiate a bot-challenge
   handshake with real TLS fingerprints". A phishing or cloaking page is more likely than a random page
   to sit behind exactly that. The tool would fail hardest on its highest-value targets. Separately,
   Browser Run attaches **non-removable** `Signature`, `Signature-Input` and `Signature-agent` headers
   (Web Bot Auth) to every request, so it is cryptographically self-identifying as a Cloudflare bot on
   both engines — that is a fine property for transparency and a poor one for reaching a hostile site
   that does not want to be looked at.
2. **Fidelity.** The docs describe rendering that "is not pixel-perfect". For a hygiene screenshot
   whose job is "does this look like your bank's login page", a small rendering lie is a real defect,
   not a cosmetic one.
3. **The binding.** Section 4.

**Verdict:** the best candidate, and still not now. Revisit on triggers T1, T2 and T5.

### 5.2 An HTML layout engine for the email-to-PDF render stage — the largest prize, and the least ready

`docs/research/in-app-conversion.md` (2026-06-21) surveyed the email-to-PDF pipeline as **parse →
normalize to print-HTML → render to PDF** and left stage 3 open with two hard constraints: never
`wkhtmltopdf` (archived 2023, CVE-2022-35583, CVSS 9.8, SSRF through an injected `<iframe>` in
user-supplied HTML), and **the render must run network-isolated** — no remote images, no external CSS,
no iframes, inline only the message's own CID parts. The recorded lean was to start on LibreOffice
headless, whose modern-CSS fidelity is "mediocre", and escalate only if exhibit fidelity demanded it,
to "a network-isolated headless-Chromium renderer" costing "~6–11× the CPU/RAM of a lightweight
renderer". ADR-0204 then refused to publish HTML as a conversion source format at all, because "exposing
it would be an arbitrary-HTML-to-PDF endpoint, the server-side-request-forgery-shaped surface the
research warned against".

Kitesurf is, on paper, a very good answer to that escalation path: a pure-Rust HTML and CSS layout
engine with a PDF output, needing no container, no C++ browser in the roster, and no 1 GB image. It is
the memory-safe version of the fallback that research reluctantly named.

**The problem is the network-isolation constraint, and it is not a detail.** Kitesurf's design centres
on SandboxOutbound, a component whose purpose is fetching arbitrary assets from the Internet. The only
documented way to suppress that is Quick Action parameters — the REST API reference for `/pdf` lists
`allowRequestPattern`, `allowResourceTypes`, `rejectRequestPattern`, `rejectResourceTypes` and
`setJavaScriptEnabled`. Those are a request filter configured per call, not the architecturally
network-isolated container the research demanded, and **whether Kitesurf honours them at all is
undocumented** — the Kitesurf page says only "add `browser=kitesurf` to any Quick Action endpoint" and
publishes no per-action compatibility matrix. A filter you have to remember to pass, on an engine that
may or may not implement it, is not the same object as a sandbox with no route to the network.

Two further cautions. An email rendered as an exhibit is an evidentiary artifact, and "not
pixel-perfect" is a materially worse property there than in a hygiene screenshot. And this would be the
first time privileged content is handed to Browser Run at all (section 7).

**Verdict:** real, and correctly parked. Do not let it disturb the LibreOffice-first lean. Revisit on
T1 plus T6.

### 5.3 Rendering our own HTML — invoices, statements, bills, reports — refuse

The `/pdf` Quick Action advertises exactly this ("Generate PDFs, such as invoices, licenses, reports,
and certificates, directly from HTML"), and it is the wrong direction for us. ADR-0128 and ADR-0162 put
PDF generation in a pure-Rust engine compiled to WebAssembly, running client-side, with the explicit
property that "the document bytes never leave the process". Routing an invoice through Browser Run adds
a network hop, takes privileged financial content out of a process that currently contains it, and
introduces a wall-clock-metered dependency to produce a document we can already produce. It buys HTML
layout we do not need for documents whose layout we control.

**Verdict:** refuse. This is the use the marketing points at and the one that fits us worst.

### 5.4 Web-page capture as evidence — a stretch, and no such feature exists

A search of `docs/` finds no designed feature for preserving a web page as evidence — no capture
workflow, no WARC, nothing in the discovery or custodian specs. If one were ever built, the
requirements would be fidelity, completeness and defensibility, which is the precise profile Kitesurf
disclaims: not pixel-perfect, no video, no WebGL, no bot challenges. Chromium would be the right engine
for that job, and Browser Run already offers it.

**Verdict:** not a Kitesurf use. Worth noting only that Browser Run's Web Bot Auth signatures would be
a genuinely useful provenance property for such a feature, on either engine.

### 5.5 Visual-regression testing the design system — refuse

`packages/design-system/visual-regression/` runs Playwright against a locally installed Chromium. A
visual-regression baseline is a pixel comparison; an engine documented as not pixel-perfect cannot
serve as one. It would also convert a free local run into a metered remote one, which is the wrong
direction while the CI budget is exhausted.

**Verdict:** refuse, on two independent grounds.

### 5.6 Scraping external sources — attorney licence lookup, parcel records, court dockets — a stretch

These sit in `docs/research/attorney-license-lookup-coverage.md`,
`docs/research/nevada-parcel-apn-system.md` and `docs/research/public-records-landscape.md`. Government
and registry sites are frequently JavaScript-heavy and frequently bot-protected, which is Kitesurf's
named weakness, and Browser Run's non-removable bot-identifying headers apply on either engine. Where
such a path is ever justified, Chromium is strictly the better engine, and the decision to scrape at
all is a legal-perimeter question (ADR-0090) before it is an engine question.

**Verdict:** not a Kitesurf-specific opportunity.

### 5.7 Giving Magnus a browser — not now, for reasons that predate Kitesurf

Kitesurf's stated audience is AI agents, and an assistant that can look at a page is an obvious pitch.
Magnus is design-only (`docs/active-work/claude/magnus-design.md`), and ADR-0109 — the client-consent
model — is still Proposed. Everything in the Agents assessment's section 9 applies unchanged. An
agent-driven browser is also a new SSRF surface with the target chosen by a model rather than by a
user, which would need `assertPublicTarget` on every navigation, exactly as ADR-0119 records for the
deferred streaming seam.

**Verdict:** defer, gated behind decisions that have nothing to do with this product.

---

## 6. Cost

**Kitesurf itself costs nothing today.** It is free while in beta, per the Kitesurf page, the changelog
and the blog. There is no Kitesurf SKU.

**Browser Run is metered, and it has no row in the operating-cost register.** That is a pre-existing
gap, not one this product creates: `env.BROWSER` is bound in `apps/worker/wrangler.jsonc` and the Safe
Website Viewer ships, but `docs/operating-costs.md` has no Browser Run line in section A or the
Cloudflare usage-rates table. The register's own rule is that every acquired service gets a row.
Proposed row, in the shape that table already uses, for the **Cloudflare usage rates** block:

| Service                                                    | Included (Workers Paid)                        | Overage rate                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Browser Run (Safe Website Viewer snapshots; `env.BROWSER`) | 10 browser-hours / mo · 10 concurrent browsers | browser hours ~$0.09/hr · concurrent browsers ~$2.00 each (monthly average of daily peaks) |

Concretely, because the owner is cost-sensitive right now: a Safe Website Viewer snapshot is a couple
of seconds of browser time, so the included ten hours covers on the order of **eighteen thousand
snapshots a month** before a cent is billed, and the daily-total-then-round billing rule means light
days round down. Quick Actions are billed on browser hours only — concurrent-browser charges apply to
Browser Sessions (Puppeteer, Playwright, CDP), which we do not use. **The realistic marginal cost of
this subsystem today is zero,** and adopting Kitesurf would not change that while the beta is free.

**What changes at general availability, and why it is the headline risk.** Cloudflare's meters are
wall-clock: browser hours and concurrent browsers. Kitesurf's own comparison table gives median wall
times of 1,148 ms versus 637 ms for a screenshot and 820 ms versus 472 ms for HTML extraction. If
Kitesurf is billed on the existing meter after beta, **each render costs 1.7–1.8× more than the same
render on Chromium**, and the 3–7× CPU and memory advantage the announcement leads with accrues
entirely to Cloudflare, not to us. Either Cloudflare introduces a resource-based meter for Kitesurf, in
which case the advantage becomes real and this section is rewritten, or it does not, in which case
Kitesurf is a memory-safety upgrade we pay a premium for. That is a legitimate trade to make
deliberately; it is not the trade the blog describes.

**Second-order cost note.** The concurrent-browser cap is 120 per account and browser hours are pooled
per account. Both are shared across every firm on the platform — see section 7 on what that means for
tenancy — so a cost blow-out and an isolation problem are the same event here.

---

## 7. The confidentiality test

**Which side of the line: in-platform.** Browser Run runs on Cloudflare, the same processor already
holding the per-firm D1 databases, the per-firm R2 buckets, and the Workers themselves. Using it does
not add a party to the privilege chain, does not send content to a frontier model, and does not require
a new processor agreement. It is the same category as Workers AI in ADR-0108's strictest-firm posture,
not the category ADR-0109 gates. Kitesurf changes nothing about that: it is a different engine inside
the same processor.

**The documentation is unusually direct about retention**, and it should be quoted rather than
paraphrased. The Browser Run FAQ, under Security and Data Handling: for Quick Actions (except
`/crawl`), Puppeteer, Playwright and CDP, "Cloudflare processes content ephemerally and does not retain
customer-submitted HTML or generated output (such as PDFs or screenshots) beyond what is required to
perform the rendering operation. Once the response is returned, the content is immediately discarded
from the rendering environment."

**Two exceptions, both avoidable, both of which should be written down as standing prohibitions:**

1. **`/crawl` stores results — including page content — in R2 for 14 days**, and crawl jobs may run for
   up to seven days. That is Cloudflare's R2, not a firm's bucket, with a retention window we do not
   control and no firm-scoped key. Never point `/crawl` at privileged content, and never use it as a
   convenience wrapper around a multi-page render.
2. **Session recording retains DOM changes, mouse and keyboard events and navigation as JSON for 30
   days**, accessible through the dashboard and API. It is opt-in and input fields are masked by
   default. Leave it off.

**What we send today is not privileged.** The Safe Website Viewer's input is a URL the user typed or
pasted, pointing at an external site. The privileged fact in that transaction is thin — that somebody
at some firm looked at this link — and the render output comes back and is not persisted.

**What section 5.2 would send is privileged, and that is a posture change worth naming.** Email-to-PDF
would hand the body of a client's email to Browser Run. It stays in-platform, the FAQ's ephemeral-
processing language covers it, and no third party sees it — so it clears the test. But it is the first
time privileged content would enter this subsystem, and the two retention exceptions above stop being
theoretical hygiene and start being invariants that need enforcing in code rather than in a document.

**Tenancy, golden rule 3, honestly.** Content isolation is sound: each Kitesurf page load is a fresh,
stateless isolate with its own cookie jar, disposed at the end of the task, so nothing from one firm's
render can reach another's. **Capacity isolation is not.** Browser hours and the 120-concurrent-browser
cap are **account-level**, shared by every firm on the platform, and the failure mode is a `429` — one
firm's burst degrades another firm's tool. Nothing crosses firms, but a noisy neighbour is visible.
That is an argument for a per-firm budget at the chokepoint before this subsystem grows a bulk
consumer, and it applies to Chromium today, not only to Kitesurf.

**Golden rule 14 — the interesting inversion.** Kitesurf drags no C or C++ into our dependency graph,
because it drags nothing into our dependency graph at all: it is a remote service, not a library, and
`pnpm-lock.yaml` and `Cargo.lock` are untouched by adopting it. Rule 14 governs what we build with, and
on its literal terms this adoption is a non-event requiring no owner consent. On the rule's underlying
_reasoning_, though, it points the other way: the rule exists because memory-unsafe code parsing
untrusted, privileged bytes is a confidentiality risk even inside a sandbox, and Kitesurf replaces a
C++ engine with a Rust one in exactly that position. That is the strongest argument in this document
for eventual adoption, and it is worth recording that the strongest argument is a safety argument, not
a cost or performance one.

**Golden rule 10.** Rendering is already off our hot path — it happens in Cloudflare's isolates, not in
our request handler. But the Safe Website Viewer route is synchronous from the user's point of view, so
Kitesurf's extra 350–500 ms of wall time per call is a real, user-visible regression, paid to gain the
memory-safety property. Small, but it should be measured rather than assumed away, and it is the same
number that drives the cost finding in section 6.

**Golden rule 1.** Satisfied by not doing anything: the port exists, and the reuse-before-building
answer here is that the reusable thing is already in place.

---

## 8. Maturity risk and the triggers to revisit

**Beta, twelve weeks old at announcement, and Cloudflare's own words are "on the road to making
Kitesurf production-ready".** Under it sit Blitz, itself a young pre-1.0 project, and Boa standing in
for `eval` — an interpreter inside an interpreter, which the announcement concedes is not optimal and
which Cloudflare intends to remove once Workers support `eval` natively. The 235,000 passing WPT
subtests are a real signal and the docs correctly caution that they measure standards conformance, not
real-world sites; the honest compatibility statement is the list of sites Cloudflare names (TodoMVC,
Wikipedia, Hacker News, its own blog and much of its own dashboard), which is a small and friendly
corpus.

**What breaks if it changes under us.** Not much, and that is the reassuring part. Engine selection is
one query parameter behind an injected port; if Kitesurf regresses on a class of pages, misrenders, or
is withdrawn, the fallback is deleting a parameter. The Quick Action contract is Browser Run's and is
shared with Chromium, so an engine change does not change our response shapes. The exposure is a
correctness one — a page that renders subtly wrong is worse than one that fails — not a lock-in one.
The larger churn risk in this area is the **Browser Rendering to Browser Run rename**, which is already
half-landed in Cloudflare's own documentation and is a small tidying job here regardless of this
decision.

**Triggers. Revisit when any of these fires:**

- **T1 — Kitesurf reaches general availability.** The gate for taking it anywhere near a privileged
  path.
- **T2 — `browser=kitesurf` becomes selectable through the `env.BROWSER` binding**, documented. Without
  this, adoption costs ADR-0119's no-API-token property, and that trade is not worth a beta engine.
- **T3 — a published post-beta price**, and specifically whether the meter stays browser-hours or moves
  to the CPU and memory Kitesurf actually saves. If it stays wall-clock, Kitesurf is the more expensive
  option and should be adopted for safety with the cost stated, not for savings.
- **T4 — Kitesurf is open-sourced and self-hostable on our own account**, which Cloudflare says it
  intends. This is the trigger that changes the architecture question rather than the cost one: a
  Kitesurf running in our own Workers puts the render inside our own perimeter.
- **T5 — bot-challenge and TLS-fingerprint capability lands.** The Safe Website Viewer specifically
  needs it.
- **T6 — documented network-isolation semantics under Kitesurf** — whether `rejectResourceTypes`,
  `rejectRequestPattern` and `setJavaScriptEnabled: false` are honoured, and whether a fully
  no-outbound render is expressible. Required before section 5.2 can be weighed against the
  LibreOffice-first lean.

**Do now, at no cost:** add Kitesurf and Browser Run to the Cloudflare platform-watch list with T1
through T6 as its conditions. That is the whole action item.

---

## 9. Owner flags

Four, each with a recommendation.

1. **K1 — Is a memory-safety upgrade worth a wall-clock cost premium?** If T3 resolves badly (the meter
   stays browser-hours), adopting Kitesurf on the Safe Website Viewer means paying roughly twice per
   render to replace a C++ parser of hostile pages with a Rust one. _Recommendation: yes, once T1, T2
   and T5 also clear — the volume is tiny and inside the included allowance, so the premium is
   arithmetic on nearly zero. Revisit if a bulk consumer ever appears._
2. **K2 — Should `/crawl` and session recording be prohibited outright rather than merely unused?** Both
   retain content past the request, and both are one convenient parameter away. _Recommendation: yes —
   record it as a local rule in `packages/safe-browse/CLAUDE.md` when that file is next touched, not as
   a new document._
3. **K3 — Should Browser Run get a per-firm budget at the chokepoint before it grows a second
   consumer?** The account-level browser-hour pool and 120-concurrent cap are shared across firms.
   _Recommendation: not yet; there is one consumer and it is low-volume. Name it as a precondition for
   email-to-PDF, which would be the first bulk consumer._
4. **K4 — Does the Browser Rendering to Browser Run rename get folded into the next Safe Website Viewer
   change, or done as its own tidy?** _Recommendation: fold it in; it touches ADR-0119, one CLAUDE.md,
   route comments and the operating-cost row proposed in section 6._

---

## 10. Eleven things not to conclude from this document

1. That Kitesurf is cheaper. On the published meter it is more expensive per render.
2. That the 3–7× figure is wrong. It is Cloudflare's own measured CPU and memory; it is simply not what
   Browser Run bills.
3. That adopting it requires owner consent under golden rule 14. It adds no dependency to our tree.
4. That it therefore has no bearing on rule 14. Its whole appeal is the rule's underlying reasoning.
5. That it sends privileged content to a third party. It does not; it is Cloudflare, in-platform.
6. That in-platform means unconditional. `/crawl` and session recording retain content for 14 and 30
   days respectively.
7. That we would need to build a seam. `BrowserRenderer` is already an injected port.
8. That the swap is therefore trivial today. It is not, because engine selection is undocumented through
   the binding.
9. That "passes any Quick Action endpoint" means every Quick Action is verified under Kitesurf. No
   compatibility matrix is published.
10. That it solves email-to-PDF. It is a candidate for one stage of it, blocked on an unverified
    network-isolation property.
11. That the WPT numbers predict real-site compatibility. Cloudflare's own documentation says they do
    not.

---

## 11. Sources

**Primary — Cloudflare product documentation**, read as raw Markdown on 2026-08-10:
[Browser Run index](https://developers.cloudflare.com/browser-run/) ·
[`llms.txt` section index](https://developers.cloudflare.com/browser-run/llms.txt) ·
[Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/) ·
[Pricing](https://developers.cloudflare.com/browser-run/pricing/) ·
[Limits](https://developers.cloudflare.com/browser-run/limits/) ·
[FAQ — Security and Data Handling](https://developers.cloudflare.com/browser-run/faq/) ·
[Wrangler bindings reference](https://developers.cloudflare.com/browser-run/reference/wrangler/) ·
[Automatic request headers](https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/) ·
[Chrome DevTools Protocol](https://developers.cloudflare.com/browser-run/cdp/) ·
[`/pdf`](https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/) ·
[`/json`](https://developers.cloudflare.com/browser-run/quick-actions/json-endpoint/) ·
[`/snapshot`](https://developers.cloudflare.com/browser-run/quick-actions/snapshot/) ·
[Session recording](https://developers.cloudflare.com/browser-run/features/session-recording/) ·
[Changelog](https://developers.cloudflare.com/browser-run/changelog/) ·
[REST API reference for `/pdf`](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/pdf/methods/create/)

**Announcements:**
[Introducing Kitesurf](https://blog.cloudflare.com/kitesurf/) (2026-08-06) ·
[Changelog: Introducing Kitesurf, an agent-first browser on Browser Run](https://developers.cloudflare.com/changelog/post/2026-08-06-kitesurf/) ·
[Kitesurf playground](https://kitesurf.cloudflare.app/)

**Upstream projects named in the architecture:**
[Blitz](https://github.com/DioxusLabs/blitz) · [Stylo](https://github.com/servo/stylo) ·
[Boa](https://boajs.dev/) · [Web Platform Tests](https://github.com/web-platform-tests/wpt)

**In-repo:** ADR-0119 (Safe Website Viewer), ADR-0120 (the `web-domains` tool group), ADR-0128 and
ADR-0162 (the pure-Rust PDF engine), ADR-0204 (the LibreOffice engine), ADR-0003 (tenancy), ADR-0090
(legal perimeter), ADR-0108 through ADR-0113 (AI and inference);
[`docs/research/in-app-conversion.md`](in-app-conversion.md);
[`docs/research/2026-08-04-cloudflare-agents-assessment.md`](2026-08-04-cloudflare-agents-assessment.md);
[`docs/research/2026-08-06-cloudflare-ai-search-assessment.md`](2026-08-06-cloudflare-ai-search-assessment.md);
[`docs/specs/2026-06-22-whois-and-safe-website-viewer-design.md`](../specs/2026-06-22-whois-and-safe-website-viewer-design.md);
[`docs/operating-costs.md`](../operating-costs.md); `packages/safe-browse/CLAUDE.md`;
`apps/worker/src/routes/tools/safe-browse.ts`; `apps/worker/wrangler.jsonc`.
