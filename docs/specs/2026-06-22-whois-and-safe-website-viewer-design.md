# WHOIS Lookup + Safe Website Viewer — design

**Status:** Accepted (design) · **Date:** 2026-06-22 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ (the Tools area; "pure utilities are libraries, not plugins") · feature-map gains a **Websites & Domains** tool group.
**ADRs (proposed, pending):** new — **the `web-domains` Tools subject group + `website` context tag**; **WHOIS via RDAP-first with a legacy port-43 fallback**; **the outbound-fetch SSRF guard as a shared security invariant**; **the Safe Website Viewer on Cloudflare Browser Rendering (static snapshot now, interactive streaming a documented seam)**. Builds on ADR-0101 (the Tools layer), ADR-0068 (access control), ADR-0017/0038 (error logging / redaction), the integration framework's http transport seam.

Two new **firm-internal security-hygiene** tools for the Tools area:

1. **WHOIS Lookup** — pull registration data for a website's domain (or an IP) so a user can see who owns it, when it was registered, where it is hosted, and its current registry status.
2. **Safe Website Viewer** — render a potentially malicious URL in an isolated remote browser and return a static snapshot (screenshot + metadata), so a user can see what a suspicious link points to **without any hostile code executing in their own browser**.

Both are everyday safety utilities, not matter work: neither attaches to a matter (`matterContext: "none"`). Both act on a new subject — a **website / domain / URL** — that today's context tags do not cover, so this design also adds the plumbing to surface them contextually wherever a URL appears later (e.g. a Directory contact's website field).

Unlike the existing library tools (`property-links`, `government-links`), which build plain `https` links and do no outbound work, **these two tools perform outbound work from the Worker** — an RDAP/WHOIS fetch and a remote browser render. They therefore follow the worker-consumed pattern (logic package → Worker route → UI widget), the same shape as the firm-usage reads, not the pure client-side link-generator shape.

---

## 1. Scope & non-goals

**In scope (this design):**

- A `whois-lookup` and a `safe-website-viewer` catalog row in `@magna-carta/tools`, a new `web-domains` subject group, and a new `website` context tag.
- `@magna-carta/whois` — RDAP-first domain/IP registration lookup with a legacy port-43 fallback.
- `@magna-carta/safe-browse` — Browser Rendering orchestration returning a static snapshot.
- A shared **SSRF guard** for validating user-supplied targets before any outbound fetch.
- Two Worker routes through the OpenAPI/zod chokepoint, gated by new `tools:whois` / `tools:safeBrowse` permissions, both seeded broadly to staff roles.
- Unit + Miniflare integration tests; developer + user docs; ROADMAP/CHANGELOG/ADR fragments.

**Non-goals (explicitly deferred):**

- **Interactive live browsing** of the suspect site (pixel streaming). Recorded as a future enhancement with its seam (Browser Sessions + Durable Object + WebSocket frame streaming) — see §7. The static snapshot fully serves the hygiene use case, and its non-interactivity is itself the strongest safety property.
- **Reputation/threat scoring** (blocklist lookups, malware verdicts). Out of scope; the viewer presents facts (redirects, content, links), not a verdict.
- **Persisting captures as matter evidence.** Use case is hygiene, not evidence; screenshots are transient (§4).

---

## 2. Information architecture — `@magna-carta/tools`

Additive changes to the pure catalog package (no UI dependency; buildable now, surfaced by the 0·7a shell like every other tool):

- **`SUBJECT_GROUP_ORDER`** gains `"web-domains"` (label **"Websites & Domains"**), inserted **before** `"diagnostics"`. These tools act on an external website subject — closer to the legal-subject groups than to the system/connectivity diagnostics — so they get their own group rather than being folded into `diagnostics`.
- **`ContextTag`** gains `"website"` — a domain/URL subject. Both tools declare `contextTags: ["website"]`. This is the contextual-surfacing seam: a future Directory/Location surface with a website field can call `toolsFor("website")` for free.
- **Two catalog rows:**

  | id                    | name                | icon     | subjectGroup  | permission         | backing   | contextTags   | matterContext |
  | --------------------- | ------------------- | -------- | ------------- | ------------------ | --------- | ------------- | ------------- |
  | `whois-lookup`        | WHOIS Lookup        | `globe`  | `web-domains` | `tools:whois`      | `library` | `["website"]` | `none`        |
  | `safe-website-viewer` | Safe Website Viewer | `shield` | `web-domains` | `tools:safeBrowse` | `library` | `["website"]` | `none`        |

  `backing: library` is correct: the catalog layer treats both as self-contained tools with no integration-connection state to reflect. That the logic runs in a Worker route (not purely client-side) is invisible to the catalog — `backing` distinguishes _integration-connection-backed_ from _not_, not _client_ from _server_. The id→component map and the route wiring live in the shell/worker, as for `firm-usage`.

- **Permissions** `tools:whois` and `tools:safeBrowse` are registered in `@magna-carta/access-control` and **seeded to all staff roles** via a new seed migration (same pattern as `tools:firmUsage`), because both are everyday safety utilities every user should be able to reach.

The catalog purity fitness test (`packages/tools/test/purity.test.ts`) must still pass — these rows reference logic by stable `id` only and import nothing below the catalog.

## 3. WHOIS Lookup — `@magna-carta/whois` + Worker route

A worker-consumed logic package. "WHOIS" and "RDAP" are recognized external-protocol terms, so the package name is allowed under the full-names rule (golden rule 12).

**Resolution strategy:**

1. **Normalize & validate** the input — accept a bare domain, a URL (host extracted), or an IP address. Reject anything that fails the SSRF guard's _public-target_ check (§5): the registry being queried is public, but the input is still user-controlled and must be sanitized (no `file:`, no internal hosts as the query subject).
2. **RDAP first.** Fetch the IANA bootstrap registries (`https://data.iana.org/rdap/dns.json` for domains, `…/ipv4.json`, `…/ipv6.json`, `…/asn.json`) to resolve the authoritative RDAP base URL for the target's TLD / IP block, then `GET {base}/domain/{name}` (or `/ip/{addr}`). Parse the structured JSON into a typed result: registrar, registration/expiry/last-changed dates, nameservers, status codes, and registrant entity (where the registry publishes it). RDAP is HTTP/JSON and fetched directly from the Worker — no third-party vendor.
3. **Legacy port-43 fallback.** For ccTLDs with no RDAP server in the bootstrap, open an outbound TCP socket via Workers' `connect()` from `cloudflare:sockets` to the TLD's WHOIS host on port 43, send the query, and return the **raw text** clearly labelled as _unparsed legacy WHOIS_ (we do not attempt to parse the long tail of free-form WHOIS formats).

**Caching (optional optimization seam, not MVP-required):** RDAP responses and bootstrap files are cacheable; a short-TTL KV cache keyed by normalized target would cut load and be polite to registries. Noted, not built in the first slice.

**Route:** `GET /api/v1/whois?query=<domain|ip>` through the existing OpenAPI 3.1 / zod chokepoint (zod request + response schemas, route-meta entry), gated by `tools:whois`. Returns `{ source: "rdap" | "whois-43", … }` so the UI can label parsed vs. raw results. Timeouts and a response-size cap apply.

**UI:** a Svelte widget in the shell keyed to `whois-lookup` — a query box and a structured result card (parsed RDAP fields) or a monospace block (raw port-43 text), with the source labelled.

## 4. Safe Website Viewer — `@magna-carta/safe-browse` + Worker route

The core safety property: the suspect page loads in **Cloudflare's remote headless Chromium**, never in the user's browser. The user only ever receives inert data — an image and text.

**Mechanism:** the Worker route calls the **Browser Rendering `env.BROWSER` snapshot** quick action (Workers binding — no API token). One snapshot call returns the rendered HTML + a screenshot; sibling actions (`/content`, `/markdown`, `/links`) fill in the rest. This requires adding the `BROWSER` binding to the Worker's wrangler config.

**Returned to the UI (all inert):**

- **Full-page screenshot** — a static image; zero live code reaches the user.
- **Final URL + redirect chain** and **HTTP status / response headers** — exposes cloaking and redirect hops.
- **Page title** and **extracted text / markdown**.
- **Outbound links** — so the user sees where the page tries to send them.

The UI renders the screenshot as an `<img>` and everything else as text. **Fetched HTML is never re-rendered as live markup in our app** — it is shown only as escaped text / structured fields.

**Retention:** the screenshot is **transient** by default — streamed through the Worker to the client, not persisted. This avoids accumulating stored hostile-site captures and matches the hygiene (not evidence) use case. A short-TTL R2 content-hash cache (to avoid re-rendering the same URL within a session) is a noted optimization seam, not MVP.

**Route:** `POST /api/v1/safe-browse` (body: `{ url }`) through the chokepoint, gated by `tools:safeBrowse`. The `url` passes the SSRF guard (§5) **before** any render. Render timeout and a screenshot-size cap apply; on capacity/limit errors from Browser Rendering, return a redacted, correlated error with a user-facing Error ID.

**UI:** a Svelte widget keyed to `safe-website-viewer` — a URL box, a prominent "rendered safely in an isolated browser" affordance, the screenshot, and the metadata/redirect/links panels.

## 5. Shared security invariants (the heart of both tools)

Because both tools fetch a **user-supplied target from inside Cloudflare**, the SSRF guard is the central correctness rule and belongs in the area's `CLAUDE.md` + `docs/conventions/invariants.md`.

- **SSRF guard** — a shared utility living with the existing http transport seam (`@magna-carta/integrations`, where the transport already lives; see the http-client transport seam). Rules: **`http`/`https` schemes only**; public hostnames only; **block** `localhost`, loopback, RFC1918 private ranges, link-local (`169.254.0.0/16`, incl. cloud-metadata `169.254.169.254`), unique-local IPv6, and other reserved ranges. The check is on the **resolved IP**, not just the literal string, to defeat DNS-rebinding-style inputs. Applied to the WHOIS query subject and to the viewer's target URL before any outbound work.
- **Redact by default** (error-logging standard, ADR-0017/0038): correlate failures by ID, **never log the full investigated URL/host or any fetched content**, and surface a user-facing Error ID. The thing being investigated may itself be sensitive.
- **Timeouts and size caps** on every outbound path (RDAP fetch, port-43 socket, browser render, screenshot).
- The future interactive-streaming seam (§7) must re-run the SSRF guard on **every navigation**, not just the initial target — noted now so it is not forgotten.

## 6. Testing

- **Unit (`@magna-carta/whois`, `@magna-carta/safe-browse`, integrations guard):**
  - SSRF guard allow/deny matrix — public hosts allowed; loopback / RFC1918 / link-local / metadata / non-http schemes / IPv6 ULA denied; resolved-IP check exercised.
  - RDAP bootstrap resolution (TLD → base URL) and response parsing into the typed result; port-43 fallback selection and raw passthrough labelling.
  - safe-browse result shaping from a stubbed snapshot payload.
- **Catalog (`packages/tools`):** purity test still passes; `toolsByGroup` places both rows under `web-domains` in order; `toolsFor("website")` returns both; both new `tools:*` permissions resolve in `assertPermission`.
- **Integration (Miniflare worker):** both routes' contract + permission gating; `GET /api/v1/whois` against a stubbed RDAP fetch; `POST /api/v1/safe-browse` against a fake `BROWSER` binding; SSRF-denied target returns the correct redacted error.

## 7. Future enhancement — interactive remote browsing (seam, not built)

A live, clickable remote-browser session — the user interacts with the suspect site while only pixels and input cross the boundary. Roughly 3–5× the build and a larger operational/cost surface; deferred. The seam:

- **Browser Sessions** (Puppeteer/Playwright + CDP `connect()`) for a persistent session with lifecycle/keep-alive/idle-timeout/teardown and concurrency limits.
- **A Durable Object per session** holding the CDP connection, coordinating state, enforcing cleanup — a new stateful component for the platform.
- **Frame streaming** — CDP `Page.startScreencast` → JPEG frames over a WebSocket to a client canvas, with throttling/backpressure.
- **Input forwarding** — client mouse/keyboard/scroll → CDP `Input.dispatch*`, with viewport↔canvas coordinate scaling.
- **Hardening** — SSRF re-checked on every navigation; downloads contained; sessions strictly ephemeral; resource/time caps; per-firm quotas and "no capacity" handling.

## 8. Documentation & rollout

- White-paper feature-map entry under the Tools area for the **Websites & Domains** group.
- `docs/user/` guide for each tool (what it does, what "rendered safely" means, what WHOIS fields mean).
- ROADMAP entry; CHANGELOG fragment (`changelog.d/`); ADR fragments (`docs/decisions/pending/`) for the four decisions named in the header.
- Area `CLAUDE.md` for the new packages, carrying the SSRF invariant locally.

---

## Build order (feeds the implementation plan)

1. **Catalog plumbing** — `web-domains` group, `website` context tag, two manifest rows, two permissions; catalog tests. (No UI, buildable now.)
2. **SSRF guard** in `@magna-carta/integrations` + tests (prerequisite for both tools).
3. **`@magna-carta/whois`** — RDAP-first + port-43 fallback + tests.
4. **`@magna-carta/safe-browse`** — snapshot orchestration + tests; wrangler `BROWSER` binding.
5. **Worker routes** — `GET /api/v1/whois`, `POST /api/v1/safe-browse` through the chokepoint, permission-gated; Miniflare integration tests; permission seed migration.
6. **UI widgets** in the shell (gated on the 0·7a shell, like every other tool).
7. **Docs** — white paper, user guides, ROADMAP/CHANGELOG/ADR fragments, area `CLAUDE.md`.
