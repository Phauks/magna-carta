# Cloudflare quick tunnels — assessment for development use

**Date:** 2026-09-18
**Scope:** What a Cloudflare quick tunnel (`cloudflared tunnel --url`, the `trycloudflare.com` hostnames) actually is, what its documented limits cost against this codebase specifically, the one place in this platform that genuinely needs one, and the confidentiality rules that would have to hold if it is ever used.
**Purpose:** Research, prompted by the owner. **This is research, not a spec and not a decision.** Nothing here is built. Nothing here changes a recorded decision.
**Prior art, not restated:** [`docs/research/2026-08-11-vpn-and-network-access.md`](2026-08-11-vpn-and-network-access.md) already settled the _product_ question — Cloudflare Tunnel is "not applicable, we have no private infrastructure," because the platform is the edge. That finding stands and this document does not revisit it. The question here is a different one: a tunnel as a **developer's tool on a developer's machine**, which the earlier assessment was not asked about.

---

## 1. Summary

**A quick tunnel is a one-command, no-account, throwaway public URL for a port on the machine that runs it.** `cloudflared tunnel --url http://localhost:8787` opens an outbound-only connection to Cloudflare's edge, and Cloudflare prints back a randomly generated `*.trycloudflare.com` hostname that proxies to that port. There is no dashboard entry, no DNS record of ours, no configuration file, and nothing to clean up: the hostname exists while the process runs and is gone when it exits, a different one next time.

**Almost everywhere it looks useful here, it is not needed** — and the reason is architectural rather than incidental. The three callbacks a platform of this shape would normally reach for a tunnel to test are all already inbound-free by design: the Collabora editing container reaches the WOPI host through a service binding with `enableInternet` false ([`apps/edit-worker/wrangler.jsonc`](../../apps/edit-worker/wrangler.jsonc)), inbound matter mail arrives through Cloudflare Email Routing into [`apps/email-worker`](../../apps/email-worker) rather than over HTTP, and every internal worker in `apps/` is reached by service binding with `workers_dev` false. A tunnel adds nothing to any of them.

**One real need exists, and it is imminent rather than hypothetical.** The payments design states it plainly: "There is no inbound webhook anywhere in this repository. Payments introduces the idiom" ([`docs/specs/2026-08-15-payments-design.md`](../specs/2026-08-15-payments-design.md), section 5.2). A processor's signed webhook is the first thing this platform will own that a third party must be able to **reach**, and a signature computed over raw bytes by someone else's server is the one class of behaviour a local fixture reproduces least faithfully. That is the honest case for a quick tunnel, and it is narrow: a handful of exploratory deliveries while the Helcim adapter is being written, against sandbox credentials, replaced by a recorded-fixture test the moment the byte shape is known.

**The limits are cheap here, with one forward-looking exception.** The 200 in-flight request ceiling (a `429` past it) and the absence of Server-Sent Events cost nothing today: there is no `text/event-stream` response anywhere in the repository, and both realtime surfaces — [`apps/api-worker/src/magnus/magnus-sockets.ts`](../../apps/api-worker/src/magnus/magnus-sockets.ts) and [`apps/api-worker/src/progress/job-progress-sockets.ts`](../../apps/api-worker/src/progress/job-progress-sockets.ts) — are WebSockets, which cloudflared proxies. The exception is a trap worth naming now: if a Server-Sent Events surface is ever added, the edge buffers `text/event-stream` and the events simply never arrive, which presents as a hung feature rather than as a tunnel limitation.

**The decisive constraint is not a limit, it is the absence of a door.** A quick tunnel's hostname lives on Cloudflare's zone, not ours, so no Cloudflare Access policy, no firewall rule, no rate limit and no WAF configuration of ours can attach to it. It is an unauthenticated public URL in front of a development machine, and the thing behind it is not the production application — it is the development build, which carries surfaces production does not, among them the `DEV_DEMO_TOOLS` demo page in [`apps/api-worker/src/app.ts`](../../apps/api-worker/src/app.ts) and the development-only response validator. For a platform whose data is privileged legal material, that is the whole analysis: **a quick tunnel is acceptable in front of fixtures and never in front of a firm's data.**

So the recommendation is: **do not adopt it as infrastructure, do not put it in any script, and do not let it become the way anyone reviews the interface.** Keep it as what it is — an ad-hoc command a developer runs by hand, for third-party callback development, under the rules in section 7.

---

## 2. What it actually is

Two commands, from the Cloudflare documentation:

```
cloudflared tunnel --url http://localhost:8080
```

That is the whole ceremony. "cloudflared will generate a random subdomain when connecting to the Cloudflare network and print it in the terminal for you to use and share." No Cloudflare account is required, no credentials are stored, and no DNS record is created in any zone we control.

Mechanically it is an outbound connection: `cloudflared` dials Cloudflare's edge, so nothing is opened on the developer's firewall and no port is forwarded. Requests arrive at the edge over TLS, are **decrypted there**, and are carried down the tunnel to the local process. That last detail matters for any signature or confidentiality reasoning: Cloudflare is in the clear path, by design, for every byte.

Against a named (remotely managed) tunnel the difference is not a feature list, it is ownership. A named tunnel has a stable hostname in a zone we control, which means it can be put behind Cloudflare Access, given a policy, logged, rate-limited, and rotated. A quick tunnel has none of that, and Cloudflare's own documentation draws the line for us: "For production use, create a tunnel instead."

## 3. The documented limits, measured against this codebase

| Documented limit                                          | What it costs here                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200 in-flight requests, `429` past it                     | Nothing for a webhook. **Disqualifying for the load-profile harness** — a tunnel must never appear in a performance measurement, since the ceiling would be the number measured. |
| No Server-Sent Events                                     | Nothing today (no `text/event-stream` in the repository; both realtime surfaces are WebSockets). A future Server-Sent Events surface would fail silently — see section 6.        |
| No SLA or uptime guarantee; features are tested on it     | Acceptable for ad-hoc use, disqualifying for anything anyone waits on.                                                                                                          |
| Random hostname per run                                   | Every processor-side webhook registration has to be re-entered each session. This is friction, and it is also the property that keeps the URL from outliving the work.           |
| Hostname is on Cloudflare's zone                          | **The decisive one.** No Access application, no rate limit, no WAF rule of ours can be attached. Section 6.                                                                      |

One further limit is not in the quick-tunnel documentation but applies because traffic transits Cloudflare's edge: request body size is bounded by the plan's edge limit. The file manager's own mode threshold is 100 MB with multipart above it ([`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md), A30), so a large-upload path exercised through a tunnel can fail at the edge for a reason that has nothing to do with the code under test. Verify the current figure before trusting an upload test run this way — or better, do not run one this way.

## 4. Where it does not apply, and why

Each of these looks like a tunnel-shaped problem and is not. The reasons are worth stating because they are the same reasons that keep the platform's attack surface small.

**Document editing.** Collabora runs in a container that never reaches the internet; it reaches the WOPI host over the `APP_WORKER` service binding, with `enableInternet` deliberately false. There is no callback from outside to arrange, in development or anywhere else.

**Inbound mail.** Capture on `in.magnacarta.esq` is Cloudflare Email Routing into a worker ([`docs/conventions/operations.md`](../conventions/operations.md), section 2a). Mail is not an HTTP callback and there is no port for a tunnel to expose.

**The internal workers.** Every worker in `apps/` except the application, the interface and the status page sets `workers_dev: false` and is reached only by service binding. Their trust boundary is the binding. Exposing one through a tunnel would not test them as they run — it would test a configuration that does not exist.

**Interface review before merge.** This is the one where the temptation is real, because the gap is real: `main` is production, `preview_urls` is `false` on all fourteen workers as a standing constraint the owner raised, and the review loop is therefore merge-then-look. A quick tunnel does not close that gap. It cannot show a deployed build — it shows the machine it runs on, which means the review is pinned to one developer's laptop being awake, at a URL with no authentication, showing a development build whose extra surfaces are exactly what a reviewer should not be looking at. If a pre-merge review surface is wanted, that is a question about a named tunnel on our own zone behind Cloudflare Access, or about the preview-URL constraint itself, and it deserves its own assessment rather than a `trycloudflare.com` hostname passed around.

## 5. Where it genuinely earns its place

**The payments webhook, while the adapter is being written.** Helcim signs with an HMAC over the raw body, verified over the raw bytes before any parsing, with a timestamp window and a constant-time comparison; the firm is identified by an unguessable per-firm path segment because the signing secret is per-firm and the body is attacker-controlled until the signature verifies (payments design, section 5.2). Two things there are genuinely hard to synthesize: the exact bytes and headers the processor sends, and the interaction between that raw stream and this codebase's own middleware — the design already warns that `idempotencyMiddleware` consumes the body through `context.req.json()` and would destroy the bytes the signature covers, failing in a way that looks like a wrong secret. Watching a real signed delivery land once is worth more than an afternoon of inference. Everything after that first delivery belongs in a recorded fixture and a test, not in a tunnel.

**A future third-party callback of the same shape**, if one is ever adopted — the e-signature vendor adapter kept as a seam for the narrow certified-filing and remote-notarization long tail, or a plugin whose provider insists on a public redirect it will not accept `localhost` for.

That is the list. It is short on purpose, and both entries are development-time, transient, and sandbox-credentialed.

## 6. The confidentiality analysis

This is the part that decides the rules rather than the verdict.

**There is no authentication step.** Anyone who has the hostname reaches the service. The URL is not guessable, but it is also not a secret in any managed sense — it is printed to a terminal, pasted into a processor's dashboard, and typed into a browser. Hostnames under `trycloudflare.com` are also a well-known destination for abuse, which means they attract scanning attention that a hostname in our own zone does not.

**The thing behind the tunnel is not the production application.** A local run carries the development-only demo page gated on `DEV_DEMO_TOOLS`, the development response validator, and whatever local state the Miniflare D1, R2 and Durable Object storage happen to hold. A tunnel does not expose the application as users meet it; it exposes the developer's build of it.

**Cloudflare terminates the TLS.** Acceptable for synthetic fixtures and a sandbox processor. Not a posture to normalize for anything else.

**Therefore the rule is a data rule, not a network rule.** Fixtures only. If a local environment has ever held real firm content — a document restored from production, a support copy, a real firm's export — that environment does not get tunneled, and the question is not negotiable by adding caution.

One corollary specific to payments: the per-firm webhook path segment is a secret, and a development one that transits a shared URL should be treated as burned and rotated, which the design already provides for (owner flag K10).

## 7. If it is used, the rules

1. Ad hoc only — typed by hand, never in `package.json`, never in a `vp` task, never in a hook, never in the gate.
2. Fixtures only. Never an environment that has held real firm data.
3. Sandbox credentials only, on both sides.
4. Bounded by the session. The process dies when the work stops; the hostname dies with it. Anything registered against that hostname in a third-party dashboard is removed at the same time.
5. Never in a measurement. The 200 in-flight ceiling means any performance number taken through a tunnel is a number about the tunnel.
6. Never the interface review path.
7. The first successful delivery becomes a fixture and a test in the same sitting. The tunnel is a way to learn the byte shape once, not a standing part of the development loop.

`cloudflared` is a Go binary run by hand, not a dependency of the workspace — nothing imports it, it enters no lockfile, and it adds no C or C++ to the tree, so golden rule 14 is not engaged. It is worth noting only so that the absence of an entry in `package.json` is understood as deliberate rather than forgotten.

## 8. What to re-check before acting

The concurrency ceiling, the Server-Sent Events exclusion and the edge body-size limit are all figures Cloudflare changes without notice, and the quick-tunnel page is explicitly where Cloudflare tests changes. Read the page at the time of use rather than trusting this document's numbers, per golden rule 11.

## 9. Things not to conclude from this document

1. Not that Cloudflare Tunnel has a product role here. It does not — that was settled in the network-access assessment and nothing here reopens it.
2. Not that a named tunnel has been assessed. It has not; only the quick variety is examined here.
3. Not that the pre-merge interface review gap has an answer. It is named in section 4 and left open.
4. Not that the payments webhook now has a testing strategy. It has a suggestion for one exploratory step; the testing strategy is the recorded fixture and the idempotency and signature tests the payments design already calls for.
5. Not that anything is adopted. Nothing is.

## Sources

Read 2026-09-18:

- [Quick Tunnels — Cloudflare One documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) — the command, the random subdomain behaviour, the 200 in-flight limit and the `429`, the Server-Sent Events exclusion, the SLA disclaimer.
- [Set up Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/) — the quick-tunnel section the owner linked, and its "for production use, create a tunnel instead" direction.
- [Cloudflare Tunnel — Cloudflare One documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) — named versus locally managed tunnels.
- [Connection limits — Cloudflare Fundamentals](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) — the edge limits that apply because traffic transits Cloudflare.
