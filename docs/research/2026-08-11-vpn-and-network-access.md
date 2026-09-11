# VPN services and network access — assessment against this platform

**Date:** 2026-08-11
**Prompted by:** the owner's question, _"how could we implement VPN services for our users?"_, sharpened mid-assessment to the underlying goal in his own words: _"I want to assist firms in accessing their files securely over insecure wifi."_
**Scope:** what "VPN" could mean for a multi-tenant legal practice-management platform whose entire surface is public Cloudflare hostnames; what Cloudflare actually sells here and at what price; what a tunnel genuinely adds over the TLS we already have; what a lawyer on hotel wifi is actually threatened by; and what confidentiality posture we would acquire if we could see a law firm's whole internet life.
**Purpose:** This is **research, not a spec and not a decision.** Nothing here is built or committed. Two decision fragments accompany it ([`no-platform-operated-vpn`](../decisions/0268-no-platform-operated-vpn.md), [`network-access-controls-firm-supplied`](../decisions/0267-network-access-controls-firm-supplied.md)); the binding decisions in the adjacent areas are already recorded — ADR-0003 (tenancy), ADR-0068 (trusted-insider access control), ADR-0046 (encryption and post-quantum posture), ADR-0023 (web/desktop parity), ADR-0017 and ADR-0038 (redact-by-default logging) — and nothing here changes any of them.

**Method.** Every load-bearing technical claim was checked against primary documentation and, where a live check was possible, against the live service: the Cloudflare One product index, the Access application-type reference, the Gateway logging-field reference, the egress-policy reference, Cloudflare's Zero Trust service-specific terms, the Chrome for Developers DBSC announcement, the FTC's consumer guidance on public wifi, and the `hstspreload.org` API queried directly for the `.esq` zone. Where I could only reach a secondary source — the two ABA formal opinions, whose PDFs are served behind a 403 to automated clients — I say so at the point of use and quote the secondary source rather than paraphrasing the opinion as if I had read it.

---

## 1. Recommendation

**Do not build or operate a VPN, in either sense. Ship the package that actually addresses the owner's stated goal, and support the VPNs firms already own.**

The stated goal — helping a firm's lawyers reach their files safely from hostile wifi — is **already met by the transport we have**, and the single most useful thing in this document is that sentence. A connection to Magna Carta from a hotel lobby is TLS 1.3 to Cloudflare's edge; the network operator sees ciphertext. `.esq` is HSTS-preloaded **at the top level** by Google Registry, verified live against `hstspreload.org` — which means every browser on earth refuses to speak plaintext to `app.magnacarta.esq` before the first packet leaves, with no header from us and no configuration a firm could get wrong. A tunnel would wrap an encrypted channel in a second encrypted channel and charge the firm for the privilege.

What a VPN genuinely adds over that is narrow, and section 4 prices each piece honestly. What actually threatens a lawyer on hotel wifi is not eavesdropping — it is phishing, an infostealer on the laptop, and the theft of a live session cookie, which is the documented cause of **80% of MFA-bypass breaches** in Microsoft's 2025 reporting. A VPN stops none of those three. Passkeys, device-bound sessions, and short re-authentication windows stop all three, and two of the three are already in our stack.

So the recommendation is a **package, not a tunnel**:

1. **Make passkeys the default second factor, and make the fallback ladder explicit.** Already designed (Better Auth, WebAuthn); the work is defaulting and onboarding, not building. Origin-bound credentials are the only control on this list that a convincing fake login page cannot defeat.
2. **Adopt Device Bound Session Credentials.** Two server endpoints and a response header, generally available in Chrome on Windows since Chrome 145/146 with macOS Secure Enclave support announced. This is the direct, standards-track answer to the stolen-cookie threat that MFA does not cover, and it degrades gracefully to today's behaviour everywhere it is unsupported.
3. **Support the firm's own identity provider as a SAML/OIDC service provider.** This is the coherent version of "a network control protecting access to Magna Carta." A firm that wants device posture, IP restriction, or a managed tunnel enforced before anyone reaches their matters gets exactly that — enforced by Cloudflare Access, Okta, or Entra in **their** account, on **their** dime, with **their** logs — and we hold nothing. Better Auth's SSO plugin is the service-provider side, and it is the highest-leverage item here.
4. **Offer optional per-firm IP allowlisting as a firm-controlled setting**, with honest warnings about what it breaks. Cheap (the Worker already has `CF-Connecting-IP`), occasionally demanded by an insurer or a corporate client's outside-counsel guidelines, and worth having as a checkbox rather than a project.
5. **Write the guidance page.** A short, accurate `docs/user/` article on working from hotels and airports that tells lawyers the truth — check the padlock, use passkeys, keep the laptop patched, never install a certificate a wifi network asks you to install — is worth more to a firm's actual security than a tunnel, and it is the artifact that makes ABA Formal Opinion 498's "consider using virtual private networks" a decision the firm makes knowingly.

On the desktop shell: **Tauri is where a connection-integrity story becomes possible**, and section 8 sets out what it can do that a browser cannot — certificate pinning, an honest network-medium and connection-integrity indicator, OS-keychain-held credentials. That is worth building when the Tauri phase opens. It is still not a VPN.

**Confidence.** High on the technical findings and the recommendation against operating a VPN — the confidentiality argument in section 6 is, in my judgment, close to dispositive and does not depend on any cost estimate being right. Medium on the ranking of threats in section 5, which rests on vendor and secondary reporting rather than on anything I could verify independently. Lower on the DBSC recommendation's timing, which depends on browser distribution among a firm's staff and is the one item worth re-checking before committing to it.

---

## 2. The three interpretations, distinguished

"VPN services for our users" resolves to at least three products with almost nothing in common. The owner has since confirmed he means **1 and 2**; interpretation 3 is not what he was asking for but survives as part of the recommendation anyway, so all three are assessed.

|                                  | **1. A network control on access to us**                                                  | **2. A general-purpose VPN we operate**                                   | **3. Coexistence and integration**                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **What it is**                   | Device posture, IP restriction, or a private path gating who reaches `app.magnacarta.esq` | The firm's whole internet traffic egressing through infrastructure we run | We run nothing; we document and behave correctly behind whatever the firm already bought |
| **Who buys it**                  | The firm, in their own identity/Zero-Trust account                                        | Us, resold or bundled to the firm                                         | Nobody                                                                                   |
| **What we build**                | A SAML/OIDC service provider + an IP-allowlist setting                                    | A VPN business                                                            | Test coverage, a settings page, a user-docs article                                      |
| **Recurring cost to us**         | ~0                                                                                        | Egress, concurrency, support, abuse handling, 24/7 on-call for a network  | ~0                                                                                       |
| **New confidentiality exposure** | None — we receive an assertion, not traffic                                               | **Total** — see section 6                                                 | None                                                                                     |
| **Verdict**                      | **Adopt**, as federation                                                                  | **Refuse**                                                                | **Adopt**, as hygiene                                                                    |

### 2.1 Interpretation 1 — a network control protecting access to Magna Carta

This is coherent, cheap, and worth doing — but **not in the form the phrase suggests**, and the reason is architectural.

There is no private network to tunnel into. Our surface is four public Cloudflare hostnames — `app`, `api`, `portal`, and the marketing origin — served by Workers static assets and a Hono Worker, with per-firm data in Durable-Object-fronted SQLite and per-firm R2. There is no VPC, no subnet, no origin server sitting behind a firewall with an RFC 1918 address. Cloudflare Tunnel exists precisely to connect **private infrastructure** to Cloudflare's edge without exposing public IPs; we have no private infrastructure for it to connect. The documentation is explicit that public-hostname protection requires neither a tunnel nor a private network: _"You do not need to install anything on the user's device — authentication happens entirely in the browser."_ A "VPN to the platform" is, for this architecture, a category error. The platform **is** the edge.

What is real is the **policy** a firm wants enforced before a session exists: this person, on a managed laptop, with disk encryption on, from an approved country, holding a valid certificate. Cloudflare Access expresses all of that, and — this is the load-bearing finding — it can express it **for a third-party SaaS application the customer does not host**, by acting as the SSO provider and federating over SAML 2.0 or OIDC. Access's SaaS application type exists for exactly this shape: _"applications your team relies on that are not hosted by your organization."_

So the correct division of labour is:

- **The firm** buys Cloudflare Access (or Okta, or Entra, or JumpCloud — the protocol is the interface, not the vendor), installs the WARP client if they want posture signals, and writes the policy.
- **We** accept a SAML or OIDC assertion from the firm's provider and create a session from it. Better Auth's SSO plugin is the service-provider implementation, supporting SAML 2.0 and OIDC with per-provider registration and domain verification, and its recent hardening rejects assertions whose audience, bearer recipient, or destination does not match the configured service provider — which is the class of bug that makes a naive SAML integration worse than no SAML at all.

The firm gets device posture, conditional access, and a managed tunnel if they want one. We get a login. We hold no network logs, no device inventory, and no posture telemetry. This is strictly better than us operating anything, and it is the answer to give the owner when he asks for interpretation 1.

Two secondary controls belong here and are genuinely cheap:

- **Per-firm IP allowlisting.** A Worker already sees `CF-Connecting-IP`; a nullable allowlist on the firm's settings, enforced at the existing chokepoint alongside tenancy and authentication, is a small vertical slice, not a project. It should ship **off by default** and with unusually blunt in-product warnings, because in 2026 it breaks more than it protects: carrier-grade NAT, mobile networks, and — the irony — a lawyer whose own VPN egresses from a rotating pool. A firm that wants this reliably needs a **stable egress IP**, which on Cloudflare means dedicated egress IPs: Enterprise-plan only, provisioned as at least two IPs in two cities, and something the firm buys, not us.
- **mTLS with Cloudflare-issued client certificates.** Cloudflare can act as a CA, issue client certificates, and enforce mutual TLS per hostname, exposing the verdict to a Worker as `cf.tls_client_auth.cert_verified`. This is the strongest device-binding control available to us **in our own account** without a client agent, and it is the honest answer for a firm with a hard "only firm-issued laptops" requirement and no appetite for Zero Trust seats. It is also operationally heavy — certificate lifecycle, enrollment, revocation, and the support burden of a lawyer whose certificate expired the morning of a hearing — so it belongs in the backlog as a named seam, not in the near roadmap.

### 2.2 Interpretation 2 — a general-purpose VPN we operate

This is a **different business**, and the assessment is a refusal. Cost first; the confidentiality case is section 6 and is the real reason.

**We cannot resell Cloudflare's.** Cloudflare's Zero Trust service-specific terms state that a customer _"shall not resell Cloudflare Zero Trust to any third parties (e.g., in an ASP, managed security services, outsourcing, time-sharing or service bureau relationship) unless expressly permitted by Cloudflare in writing,"_ with violation treated as a material breach subject to immediate account termination. Given that our entire platform lives in that account, this is not a clause to be casual about. There is a managed-service-provider path — Cloudflare's PowerUP program has Resell, Manage, Distribute and Consult routes, and its own commentary describes MSPs as embedding Cloudflare rather than reselling it, on not-for-resale licensing with consumption tracking Cloudflare _"is still building."_ That is a partnership negotiation, a contract, a billing integration, and a compliance obligation — an entire corporate workstream, undertaken to deliver a benefit section 4 shows is close to zero.

**Building our own is worse.** Workers cannot terminate a VPN: they are HTTP-inbound only, which the white paper already notes when ruling out SMB and FTP capture. A VPN concentrator is a long-lived stateful network process with an egress IP, which on Cloudflare means Containers used for something they are not shaped for, or infrastructure outside Cloudflare — abandoning the single-provider simplicity that is one of this platform's stated advantages. Then the standing costs begin: bandwidth for every byte of a firm's internet use rather than just their matter files; abuse handling, because an egress IP a law firm shares will eventually be used for something that generates a complaint; IP-reputation management, because the moment our egress lands on a blocklist a lawyer cannot reach a court's filing system; and 24/7 network on-call, because a VPN that is down is not a degraded feature, it is a firm that cannot work.

**And the per-seat economics never favour us.** Cloudflare's own published entry point for Zero Trust is a free tier and a low per-user monthly rate; multiple independent trackers put the paid tier at $7 per user per month, and I was **unable to verify that figure against a Cloudflare-authored page** — their pricing landing page is a navigation shell and the developer docs discuss seat mechanics without naming a price. Treat the number as unverified. What is verifiable and matters more is the shape: a firm can serve up to a substantial free tier at zero cost, in their own account, today. We cannot underprice free, and we would be taking on unbounded liability to compete with it.

### 2.3 Interpretation 3 — coexistence and integration

We run nothing and make sure the platform behaves correctly for the firms — which is most firms with any IT maturity — already behind a corporate VPN, a Zero Trust agent, or a filtering proxy. This is not a feature so much as an absence of bugs, and the failure modes are specific enough to test:

- **A shifting egress IP must never invalidate a session.** WARP and most corporate VPNs re-home between data centres; a session tied to a source IP will log a lawyer out mid-deposition. Our sessions must not bind to IP. (Note the tension with 2.1's allowlist: an allowlist that evaluates per-request is the correct design, and it must fail with a clear, distinct error rather than a generic 401, so support can tell "your firm's allowlist rejected this address" from "your session expired.")
- **A TLS-inspecting proxy must not break WebSocket upgrades.** We now have two push-progress WebSocket surfaces — bundle builds and conversion jobs — and enterprise middleboxes are historically hostile to upgrades. The poll fallback already exists by design, which is the right architecture; what is missing is a test that the fallback actually engages when the upgrade is blocked rather than leaving a spinner.
- **Geo-restriction policies must not silently break the platform.** A firm whose Gateway policy blocks a region will find R2 presigned URLs or Container-backed services failing opaquely.
- **Guidance, not just tolerance.** A `docs/user/` article naming which of our hostnames must be reachable lets a firm's IT administrator write a correct policy the first time.

---

## 3. What Cloudflare actually offers, and what is reachable from here

| Product                                          | What it does                                                                                                               | Reachable for us?                                                                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Access**                                       | Authenticates users to applications; policies over identity, device posture, IP, country; full audit log                   | **Yes — as federation.** The firm runs it; we are a SaaS application over SAML/OIDC. Can also protect a Worker by name, or a public hostname, in **our** account |
| **Gateway (SWG)**                                | Filters DNS, network and HTTP traffic; acceptable-use policy                                                               | Only if we operated the firm's traffic. See section 6                                                                                                            |
| **WARP / Cloudflare One Client**                 | Device agent; routes traffic to Cloudflare; supplies posture signals                                                       | The firm installs it. We never touch it                                                                                                                          |
| **Tunnel**                                       | Outbound-only connector from private infrastructure to the edge                                                            | **Not applicable.** We have no private infrastructure                                                                                                            |
| **Device posture**                               | Three check families: client-based (needs WARP), service-to-service (third-party providers), and Access-integration checks | Reaches us **only as claims in an assertion**                                                                                                                    |
| **Dedicated egress IPs**                         | Static, account-unique egress addresses for WARP/Gateway traffic; minimum two, in two cities                               | **Enterprise only**, bought by the firm. The prerequisite for allowlisting to work                                                                               |
| **Browser Isolation, DLP, CASB, Email Security** | Remote browser execution; data-loss scanning; SaaS posture; inbox policy                                                   | The firm's tools. DLP scanning _our_ traffic is the firm's decision and their exposure                                                                           |
| **mTLS / client certificates**                   | Cloudflare-managed CA issues client certs; per-hostname enforcement; verdict exposed to the Worker                         | **Yes, in our account.** Backlog seam — see 2.1                                                                                                                  |

The pattern is consistent. **Everything in Cloudflare One that is valuable to a law firm is valuable in the firm's own account.** Nothing in it becomes more valuable by being operated by their practice-management vendor, and several things become considerably more dangerous.

---

## 4. What a tunnel genuinely adds over the TLS we already have

This is the section the owner should read if he reads only one, because it prices the mechanism against the goal.

**The baseline is stronger than it sounds.** Traffic to `app.magnacarta.esq` is TLS 1.3 to Cloudflare. `.esq` is on the HSTS preload list **as a whole zone** — queried live during this assessment, `hstspreload.org` returns `{"name":"esq","status":"preloaded","preloadedDomain":"esq"}` — because Google Registry preloads its TLDs at the top level, so every second-level domain inherits forced HTTPS in every major browser without registering individually. The practical consequences are worth stating plainly: there is no plaintext first request to strip, `sslstrip`-class downgrade attacks do not apply, and a captive portal cannot serve a lawyer a plaintext impostor of our login page at our own hostname. The FTC's current consumer guidance says the same thing about the general case in as many words: _"In the early days of the internet, they often weren't secure. But things have changed... Because of the widespread use of encryption, connecting through a public Wi-Fi network is usually safe."_ The page does not mention VPNs at all.

Against that baseline, here is everything a VPN adds, and what each is worth to a lawyer in a hotel:

**a. Hostname metadata — DNS and SNI. Partly already solved; worth little.** Without a tunnel, the network sees which hostnames a device resolves and connects to, though not the paths or content. Two things reduce this to near-nothing for us specifically. DNS-over-HTTPS is default-on in current Chrome, Firefox and Edge, removing plaintext DNS. And Encrypted Client Hello — standardised as RFC 9849 in March 2026, and enabled by default across Cloudflare-fronted sites — conceals the specific hostname behind a shared public name, so an observer learns _"a site on Cloudflare"_ rather than _"magnacarta.esq"_. What survives is destination IP, which for us is a Cloudflare anycast address shared with a large fraction of the web. **A VPN's marginal contribution here is to substitute our identity as the observed destination for Cloudflare's, which is not obviously an improvement.** Note honestly that ECH is a moving target — it has been enabled, withdrawn and re-enabled before, and it is a property of Cloudflare's configuration, not a guarantee we control.

**b. A captive portal that persuades the user to install a root certificate. Real, and a VPN does not reliably fix it.** This is the one attack that defeats TLS, and it deserves to be taken seriously because hotel and conference networks train users to click through exactly this dialogue. But note what actually happens: a device that has trusted a hostile root CA is a **compromised device**. A VPN client running on that device is not immune — the same administrative access that installed the CA can inspect, block, or race the tunnel, and a captive portal that blocks the tunnel simply produces a lawyer who disables it to get online. The controls that survive a rogue CA are **certificate pinning** (which the browser cannot do — HPKP was deprecated and removed — but a Tauri shell can, see section 8) and **passkeys**, which are bound to the origin and are not disclosed to a proxy that can decrypt the channel. HSTS preloading also helps here: it prevents the downgrade path, though not a decrypting proxy the user has explicitly trusted.

**c. Non-TLS traffic the device makes anyway. Not our traffic, and not our problem to solve.** A tunnel does protect a lawyer's stray plaintext IMAP or an ancient legal-research client. That is a real benefit — to the firm, from the firm's own VPN. It has nothing to do with reaching Magna Carta and is not a reason for us to operate one.

**d. A stable egress IP for allowlisting. Real, and the firm's to buy.** Covered in 2.1. Enterprise-tier dedicated egress IPs, in the firm's account.

**e. Wifi-layer attacks below TLS — evil twin, ARP spoofing, deauthentication. Overtaken by HSTS and TLS.** These get a rogue network into the path. With preloaded HSTS and certificate validation, being in the path yields ciphertext and a hostname. The residual value is denial of service, which a VPN does not fix either.

**The honest summary: for the owner's stated goal — a lawyer reaching their files from hostile wifi — a VPN's marginal security contribution over what we already have is close to zero.** It is not zero; (b) and (c) are real. But (b) is better addressed by pinning and passkeys, and (c) is not about us.

---

## 5. What actually threatens a lawyer on hotel wifi

Ranked, with the strongest supporting evidence I could find and an honest note on its quality. This ranking is the crux of the recommendation, and it is the part I hold with the least certainty, because the good data here is vendor data.

1. **Credential phishing.** A convincing fake login page reached from an email or a sponsored search result. The FTC's guidance makes this point about encryption's limits directly: your data _"may be encrypted on its way to the site, but it won't be safe from scammers operating the site."_ A VPN does nothing. **Passkeys do** — a WebAuthn credential is scoped to the origin that created it and simply will not present itself to a lookalike domain. This is the single highest-value control available and it is already in our stack.
2. **Session-cookie theft, usually by infostealer malware on the device.** Secondary reporting attributes **80% of MFA-bypass breaches** to session-token theft, citing Microsoft's 2025 Digital Defense Report, and describes stolen passwords and session cookies appearing in a large majority of breaches. I could not reach the primary reports directly and flag the figures as secondary. The mechanism, though, is not in dispute and is the reason DBSC exists: a stolen cookie is post-authentication bearer material, replayable from anywhere, and MFA never fires again. **A VPN does nothing. DBSC does** — binding the session to a TPM- or Secure-Enclave-held key means an exfiltrated cookie cannot be refreshed off-device.
3. **Device compromise.** An unpatched laptop, a malicious download, a trusted rogue CA. A VPN running on a compromised device protects the attacker's traffic as diligently as the lawyer's. **Device posture addresses this** — and the right party to enforce it is the firm's identity provider, per interpretation 1.
4. **Shoulder-surfing and physical exposure.** Genuinely a leading cause of inadvertent disclosure in public settings, and the one item on this list no software control touches. It belongs in the guidance article, alongside the point that ABA Formal Opinion 498 makes about being overheard.
5. **Network eavesdropping.** Last, because TLS handles it. This is the threat a VPN is built for and it is the smallest one on the list.

The pattern is stark: **the top three threats are all defeated by controls we can build in the application, and none of them is defeated by a tunnel.**

### Cheaper partial answers to the metadata problem

- **HSTS.** Already ours by TLD preload. We should still emit `Strict-Transport-Security` ourselves — defence in depth, and it covers non-browser clients (the Tauri shell, the public API's SDK consumers) that do not consult the preload list. Worth checking as part of the security-header set the preview host already establishes in `apps/worker/src/files/preview-headers.ts`.
- **Certificate pinning.** Not available in browsers. Available and appropriate in Tauri — section 8.
- **DNS-over-HTTPS.** Default-on in current browsers; nothing for us to build, worth one line in the guidance article.
- **Encrypted Client Hello.** Inherited from Cloudflare, not controlled by us. Worth confirming it is on for our zone and noting that it can change.

---

## 6. The confidentiality analysis — why operating a VPN is disqualifying

Everything above is a cost-benefit argument, and cost-benefit arguments can be overturned by a sufficiently motivated owner. This one cannot, and it is the reason interpretation 2 is a refusal rather than a deprioritisation.

**What we would see.** Gateway's own logging reference is the specification of the exposure, and it is worth reading as such. DNS logs record the query name, query type, resolved IPs, resolver decision, and — crucially — the **identity**: email, user ID, device name, device ID, and last-authenticated time. Network logs record source and destination IP and port, SNI, detected protocol, and the same identity block. HTTP logs record host, **full URL**, method, status, user agent, source IP, and the same identity block. That is not "traffic metadata" in the abstract. That is a per-lawyer, per-device, timestamped record of every hostname and URL a firm's staff reach.

**Why that is categorically different from what we hold today.** We hold a firm's matters. Those are the documents the firm chose to give their practice-management vendor, about representations the firm has already undertaken. Whole-internet metadata is a different kind of object:

- It reveals **the existence of matters we were never told about** — an unfiled complaint drafted after repeated visits to a specific court's e-filing system; an undisclosed representation inferable from sustained traffic to a company's investor-relations pages; a merger visible in the pattern of due-diligence lookups weeks before anything is public.
- It reveals **the firm's relationship to adversaries** — traffic to opposing counsel's site, to an expert-witness directory, to a specific insurer's portal.
- It reveals **the personal**, because a work laptop is also the laptop on which someone researches a medical diagnosis or a divorce lawyer. We would be holding that about the employees of every client firm.
- It is **inferential in a way document custody is not.** Holding a file tells you what the firm wrote. Holding six months of browsing tells you what the firm is thinking about, and when it started.

**The legal exposure is the sharpest edge, and it cuts in a direction that specifically harms the client.** Operating a VPN would make us a provider of an "electronic communication service" under the Electronic Communications Privacy Act, and the Stored Communications Act draws a hard line between content and non-content records. Connection logs, timestamps, IP addresses, session records, and subscriber information are **non-content**, and non-content records held by a service provider are obtainable on a **subpoena** — a materially lower threshold than the warrant required for content.

Follow that through, because it is the whole argument. Today, a firm's browsing metadata sits with the firm. An adversary who wants it must go to the firm, and the firm — the party who owns the privilege, knows which matters are implicated, and has both the standing and the professional obligation to fight — moves to quash. If we operate the VPN, the same material sits with **a third party who is not the client's lawyer, holds no privilege in it, and can be reached by subpoena in litigation the firm may not even be a party to.** We would become the cheapest available route to a law firm's confidential information, and we would have created that route on purpose, for a benefit section 4 measures at approximately nothing. Whether we could or would notify the firm in time to let them object is a matter of our process and the terms of the order — which is precisely the point: a protection that currently rests on the firm's own standing would come to rest on our diligence.

**It also inverts the platform's stated posture.** The rules we already hold ourselves to are unusually strict and were chosen deliberately: redact by default, never log privileged content, no third-party error SaaS, application-level encryption narrowly scoped with an audited read chokepoint, per-firm crypto-shred so destroying a key destroys the corpus. Every one of those exists to **minimise what we can see**. A VPN maximises it. And it does so in a form our existing machinery cannot protect: `protected()` encrypts a declared field on write, but network logs are operational telemetry generated continuously by the act of routing, not domain rows written through the data-access layer. Crypto-shred would not reach them. We would be building the one dataset in the company that our confidentiality architecture does not cover.

**And the breach surface is material the firm never gave us.** A breach of matter data is grave and the firm can reason about it, because they know what they gave us. A breach of whole-internet metadata discloses information about **unfiled matters, undisclosed clients, and third parties who never had any relationship with us at all** — and the firm cannot scope the damage, because they never had an inventory of what they were handing over.

**Conclusion.** The confidentiality gain to the firm is close to zero, because TLS already provides it. The concentration of risk in us is very large, is legally worse for the client than the status quo, and is not addressable by any control in our current architecture. **This is not a close call, and the recommendation would be the same if operating a VPN were free.**

---

## 7. What the profession actually requires

Two sourcing caveats first. The ABA serves both formal opinions as PDFs behind a 403 to automated clients; I could not read either primary text and quote below from named secondary sources that quote them, saying which. Neither opinion is binding anywhere — they are ABA guidance on Model Rules, and the operative authority is the rule as adopted in each state, which for this firm means Nevada's RPC 1.6.

**The standard is "reasonable efforts," and it is deliberately technology-neutral.** Model Rule 1.6(c) requires reasonable efforts to prevent inadvertent or unauthorised disclosure of information relating to a representation. ABA Formal Opinion 477R applies that to transmission over the internet, holding that a lawyer generally may transmit client information over the internet where reasonable efforts have been made, with heightened precautions where the information's sensitivity, an agreement with the client, or the law requires them — and describing encryption as a _"particularly strong protective measure"_ that is _"warranted in some circumstances."_ The standard is fact-specific by design. It mandates no product.

**ABA Formal Opinion 498, on virtual practice, is the one that mentions VPNs — and its verb is "consider."** As quoted by the Louisiana State Bar's legal-ethics service: _"When connecting over Wi-Fi networks, lawyers should ensure that routers are secure and consider using virtual private networks (VPNs)."_ Holland & Knight's analysis of the same opinion records that it _"leaves a number of decisions to each lawyers' discretion based on individual circumstances, including when to use a virtual private network (VPN), when to use encryption technology and which specific technology vendors fail to offer sufficient protections."_ The opinion's other technology guidance — full-disk encryption, strong and periodically changed passwords, prompt security updates, firewalls and anti-malware, backups with tested recovery, disabling smart speakers during client calls, and awareness of physical surroundings on video — is notably **device and habit hygiene**, not network architecture.

Three things follow for us:

1. **The obligation is the firm's, not ours.** 498 addresses the lawyer's own environment: their router, their laptop, their passwords, their surroundings. It is not a specification for what a practice-management vendor must operate.
2. **"Consider using a VPN" is satisfied by the firm considering it.** Our contribution is to give them accurate information to consider with — which is the guidance article — and to work correctly if they decide yes, which is interpretation 3.
3. **Where we can genuinely help is the parts of 498 that touch our surface**: making strong authentication easy and default, not obstructing a firm's own controls, and being clear about what we do and do not encrypt. That is the recommendation in section 1.

---

## 8. The client portal and the desktop shell

**The client portal (Phase 6) is where a VPN is not merely unhelpful but incoherent.** The portal's recipients are clients, co-counsel, experts, adjusters, and other Directory contacts, on devices we will never manage, reached through grants with per-share assurance levels. You cannot ask an opposing party's expert witness to install your VPN client to read one shared folder. The portal's design already answers the same underlying question with the right tools — **short-lived signed URLs, instant revocation, per-grant assurance escalation up to account-plus-2FA, quarantined uploads requiring staff acceptance, and metadata-only audit** — and those are the controls that fit an unmanaged external device. The portal's problem is the inverse of the staff problem: not "is the network trustworthy" but "is this person who they claim to be, on a device nobody vetted." The answer is assurance level per grant, which is already designed. **No network control belongs anywhere near the portal**, and any future proposal to add one should be read as a symptom that the assurance model is not being used properly.

**The desktop Tauri shell is the one place a genuine connection-integrity story is possible**, and it is worth flagging now because the parity rule shapes what may be built. Three things Tauri can do that a browser cannot:

- **Certificate pinning.** The browser cannot pin — HPKP is gone — but a Tauri app controls its own HTTP client and can pin to our issuer or leaf set. This is the correct answer to the trusted-rogue-CA attack in 4(b), and it is meaningfully stronger than a tunnel, because it fails closed against exactly the interception a tunnel on a compromised device does not stop.
- **Honest connection and device signals.** The white paper already notes the desktop can read the physical network medium where the browser cannot, and routes such observations to `docs/desktop-build-avenues.md`. A connection-integrity indicator — pinned, TLS 1.3, no interception detected — is a truthful, useful thing to show a lawyer in a hotel, and it is the closest we should come to a "you are secure" claim.
- **OS keychain and hardware-backed credentials**, already in the parity table, which is the desktop expression of the same anti-session-theft goal DBSC serves on the web.

**Parity check.** ADR-0023 requires that no feature be desktop-exclusive; the desktop may add optional local accelerations with a server fallback. Pinning and a connection indicator satisfy this: the web path is complete (TLS with preloaded HSTS, and the same session), and the desktop adds a local hardening that degrades to the web behaviour. **A desktop-only VPN client would not satisfy it**, which is an independent structural reason interpretation 2 does not fit this platform even if everything in section 6 were somehow answered.

**Memory-safety and the C/C++ consent rule.** If a client binary were ever on the table, golden rule 14 binds. The finding is mildly favourable and does not change the conclusion. Cloudflare's WARP is built on BoringTun, Cloudflare's own userspace WireGuard implementation **in Rust**, and its newer MASQUE transport is likewise Rust — so recommending that a firm install WARP does not push C or C++ into anyone's trust boundary. Two honest caveats: the WARP client as shipped is a proprietary binary of which only BoringTun is open source, so "Rust" is a statement about the datapath, not an audit; and it would be **the firm's** installed software, not our dependency, so the rule's consent gate is not the operative control anyway. If we ever built our own client, Rust would be the obvious and available choice — `boringtun` is a published crate — which means memory safety is **not** among the reasons to refuse. The reasons to refuse are in sections 4 and 6, and they are sufficient.

---

## 9. What I rejected, and why

- **Operating a general-purpose VPN for firms.** Section 6. Not a cost decision.
- **Reselling Cloudflare Zero Trust.** Forbidden by the Zero Trust service-specific terms absent written permission, with material-breach and immediate-termination consequences for the account our entire platform runs in. The MSP path exists but is a corporate workstream delivering near-zero security benefit.
- **A "tunnel to the platform."** No private network exists to tunnel to. Access on a public hostname needs no tunnel and no client, by Cloudflare's own documentation.
- **Requiring the WARP client for staff access.** Would force every firm into an agent rollout for a benefit TLS already provides, break the bring-your-own-device reality of small firms, and contradict interpretation 1's finding that the firm's own identity provider is the right enforcement point.
- **Mandatory IP allowlisting.** Breaks carrier-grade NAT, mobile work, and — self-defeatingly — lawyers already using their own VPN. Correct as an **opt-in** firm setting with blunt warnings; wrong as a default or a requirement.
- **Building our own VPN client.** Rust makes it memory-safe, not wise. It is a network product, an on-call rotation, an abuse desk, and an IP-reputation problem, and it delivers section 4's near-zero marginal benefit while creating section 6's exposure.
- **A desktop-only VPN in the Tauri shell.** Fails ADR-0023 parity independently of everything else.
- **Any network control on the client portal.** Incoherent against unmanaged external recipients; the per-grant assurance model is the designed and correct answer.
- **Marketing any of this as "bank-level security" or "military-grade encryption."** Rejected on principle. Selling a lawyer a tunnel to fix a problem TLS already fixed, while the real risk is the phishing email in their inbox, is a security-theatre product that makes the firm's actual posture **worse** by consuming the attention and budget that passkeys and patched laptops need. The best thing we can sell a firm here is an accurate explanation.

---

## 10. What to re-check before acting

1. **The $7-per-user Zero Trust price and the free-tier seat count.** Multiple third-party trackers agree; **no Cloudflare-authored page confirmed either figure** during this assessment. Verify from the dashboard before quoting a number to a firm.
2. **DBSC browser reach.** Generally available in Chrome on Windows (Chrome 145/146, April–May 2026); macOS Secure Enclave support announced, not confirmed shipped. Firefox and Safari positions unverified. Check distribution across a real firm's fleet before committing the two server endpoints — though the graceful-degradation design means early adoption costs little.
3. **ECH's status for our zone.** Inherited from Cloudflare, previously withdrawn and reinstated once. Confirm it is on and treat it as a property that can change, not a guarantee.
4. **Whether we emit our own HSTS header.** TLD preload covers browsers; it does not cover the Tauri shell or SDK consumers. Worth an explicit check against the worker's response headers.
5. **The two ABA opinions, read in full by a human.** Both were quoted here from secondary sources because the primary PDFs are 403 to automated clients. Nothing in this document turns on a fine reading of either, but any user-facing or marketing claim about ethics compliance must be grounded in the primary text — and in **Nevada's** RPC 1.6 as adopted, not the ABA Model Rule.
6. **Whether any client of a firm has contractual outside-counsel guidelines mandating VPN or IP restriction.** This is the one plausible route by which a firm would genuinely need interpretation 1's allowlist, and it is a sales question, not a research question.

---

## 11. Eleven things not to conclude from this document

1. Not that public wifi is safe in general — that TLS makes **eavesdropping on our traffic** a solved problem, which is narrower.
2. Not that VPNs are useless — that a VPN **operated by us** adds nearly nothing to reaching our platform, while costing a great deal elsewhere.
3. Not that firms should stop using their own VPNs. Many have good reasons unrelated to us, and 498 tells them to consider it.
4. Not that Cloudflare One is a bad product. It is a good product, bought in the firm's account.
5. Not that device posture is unimportant. It is important and it belongs in the firm's identity provider, reaching us as assertion claims.
6. Not that we should never gate access by network. An opt-in per-firm allowlist is recommended; a default or mandatory one is not.
7. Not that ECH or HSTS makes us unobservable. An observer still learns that a device talks to Cloudflare, and traffic-analysis attacks are out of scope here.
8. Not that DBSC is a complete answer to infostealers. It devalues stolen cookies; it does not clean a compromised laptop.
9. Not that passkeys eliminate phishing. They eliminate **credential** phishing; consent phishing and malicious-download social engineering remain.
10. Not that the SAML/OIDC service-provider work is small. It is the largest item in the recommendation and needs its own spec — assertion validation is a well-known source of critical authentication bugs, and Better Auth's own recent hardening of audience, recipient and destination checks is evidence of how sharp those edges are.
11. Not that this is a decision. It is research. Two decision fragments accompany it and both are **Proposed**.

---

## Sources

Cloudflare product and platform documentation:

- [Cloudflare One overview](https://developers.cloudflare.com/cloudflare-one/) — component products and their roles
- [Choose an application type](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/choose-application-type/) — self-hosted, SaaS, infrastructure; Worker-by-name protection; the "no client install" statement
- [Gateway logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/gateway-logs/) — the DNS, Network and HTTP field lists quoted in section 6
- [Egress policies](https://developers.cloudflare.com/cloudflare-one/traffic-policies/egress-policies/) and dedicated egress IPs — Enterprise availability, two-city minimum
- [Device posture checks](https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/) — the three check families
- [Client certificates / mTLS](https://developers.cloudflare.com/ssl/client-certificates/) — Cloudflare-managed CA, per-hostname enforcement, `cf.tls_client_auth.cert_verified`
- [Cloudflare One getting-started FAQ](https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/) — seat consumption and removal-versus-revocation
- [Zero Trust service-specific terms](https://www.cloudflare.com/service-specific-terms-zero-trust-services/) — the resale prohibition
- [Cloudflare One Partner Program](https://blog.cloudflare.com/cloudflare-one-partner-program/) and [service partner strategy](https://blog.cloudflare.com/shaping-the-future-cloudflares-service-partner-strategy/) — the MSP path
- [BoringTun](https://github.com/cloudflare/boringtun) and [Zero Trust WARP with a MASQUE](https://blog.cloudflare.com/zero-trust-warp-with-a-masque/) — the Rust datapath
- [ECH protocol](https://developers.cloudflare.com/ssl/edge-certificates/ech/) and [Good-bye ESNI, hello ECH](https://blog.cloudflare.com/encrypted-client-hello/)

Standards, browser platform, and live checks:

- [`hstspreload.org` API](https://hstspreload.org/) — queried live, `esq` returns `status: preloaded`
- [HSTS preload and Google Registry](https://kb.porkbun.com/article/96-hsts-preload-and-google-registry) — TLD-level preload covering `.esq`
- [Device Bound Session Credentials — Windows GA announcement](https://developer.chrome.com/blog/dbsc-windows-announcement) and [DBSC documentation](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)
- [Google Workspace: DBSC generally available](https://workspaceupdates.googleblog.com/2026/05/prevent-account-takeovers-with-DBSC-now-generally-available-in-the-Chrome-browser-for-Windows.html)
- [Better Auth SSO plugin](https://better-auth.com/docs/plugins/sso) — SAML 2.0 / OIDC service provider, assertion validation hardening

Professional responsibility and legal exposure:

- [FTC — Are public Wi-Fi networks safe?](https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know) — quoted directly
- ABA Formal Opinion 498, via [Louisiana Legal Ethics](https://lalegalethics.org/aba-issues-formal-opinion-on-virtual-law-practice/) and [Holland & Knight](https://www.hklaw.com/en/insights/publications/2021/03/aba-offers-general-guidance-for-virtual-law-practices) — **secondary; primary PDF returns 403**
- ABA Formal Opinion 477R, via [LegalClarity](https://legalclarity.org/aba-formal-opinion-477r-lawyer-cybersecurity-duties/) — **secondary; primary PDF unreadable**
- [CRS — Overview of Governmental Action Under the Stored Communications Act](https://www.congress.gov/crs-product/LSB10801) and [EPIC on ECPA](https://epic.org/ecpa/) — the content/non-content distinction and the subpoena threshold

Threat data (**all secondary — vendor and analyst reporting, primary reports not reached**):

- Microsoft Digital Defense Report 2025, cited for the 80% MFA-bypass/session-theft figure
- Flashpoint, Cynet and related 2026 infostealer reporting, cited for infection and credential volumes
