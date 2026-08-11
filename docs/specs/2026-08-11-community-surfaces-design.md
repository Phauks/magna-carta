# Community surfaces — public changelog, feature voting, and community board — design

**Status:** Proposed (design) · **Date:** 2026-08-11 (revised same day after owner direction) · **Owner:** Trevor Goldsmith
**White-paper home:** _Community & feedback forum_ and _Product updates (changelog, release notes & roadmap)_
**Builds on:** [`2026-06-17-community-feedback-board-design.md`](2026-06-17-community-feedback-board-design.md) (ADR-0044, amended — native `@magna-carta/community` build, and the dormant `discussion` seam this design wakes), ADR-0048 (product updates), [`2026-07-02-service-status-design.md`](2026-07-02-service-status-design.md) (the isolated public read worker, shipped), [`2026-08-10-self-serve-firm-provisioning-and-entitlements.md`](2026-08-10-self-serve-firm-provisioning-and-entitlements.md) (the free tier, Turnstile, registration)
**Reference product:** ClickUp, at the owner's direction. Surfaces studied 2026-08-11 and evidenced in section 2.
**Decisions proposed:** `community-surfaces-sequencing`, `public-changelog-audience-and-source`, `community-surface-placement`, `community-identity-and-vote-eligibility`, `community-moderation-and-removal-posture`
**Produces:** this design and its decision fragments. **No product code, no schema, no package, no route.**

---

## 1. Recommendation, ranked

| Rank | Surface                                      | Value                                                                                  | Effort     | Risk                                                      | Verdict                                                             |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | **Public changelog**                         | High and immediate — credibility, acquisition, and the public half of a needed surface | **Low**    | **Near zero.** No writes, no accounts, no user content    | **Build first, alone.**                                             |
| 2    | **Feature requests and voting**              | Real, and the acquisition value is larger than the first draft of this spec credited   | **Medium** | **Medium.** Commitment pressure, moderation, a dead board | **Build second. Public to read, login to write.**                   |
| 3    | **Community questions (the threaded board)** | Real, and it is what the reference product actually does under the word "forum"        | **Medium** | **Contained, by scope and structure — not by rules**      | **Build third, on the same board, same identity, same moderation.** |

**Sequencing.** Public changelog now. The request board next. Questions third, on the same substrate — it is one board with two post kinds, not a second product.

**What changed from the first draft, and why.** The owner directed: _"Look at what clickup does for changelogs and forums, that is what i want."_ The first draft recommended against a forum. **That recommendation is withdrawn, and the evidence that withdrew it is ClickUp's own.** Section 2 sets out what ClickUp actually runs; section 4 sets out why the reconciliation holds and where it does not. The short version is that **ClickUp has no discussion forum, and what it does have under that heading is a category-structured, status-tracked board with long-lived comment threads** — which is a shape the confidentiality analysis permits, because every thread is anchored to the software rather than floating free.

**Why one document.** The three surfaces ship independently, but identity, placement, moderation and the retrofit list are shared. Three documents would state them three times.

---

## 2. What ClickUp actually does

Studied 2026-08-11. Everything below was verified against the live surfaces, not recalled.

### 2.1 The changelog — public, hosted on Canny, marketing-voiced, two-level

[`clickup.canny.io/changelog`](https://clickup.canny.io/changelog) is **public and unauthenticated** (a login control exists in the header; the content does not need it).

- **Hosted on Canny**, a third party — the same vendor that hosts their feedback board.
- **Reverse-chronological, with a single `new` label.** No category taxonomy on the changelog itself.
- **Roughly monthly at this level**, and thematic rather than exhaustive: recent titles are "Brain²: Release Notes Takeover", "The best AI is your AI. Brain² is here.", and — notably — "Ask ClickUp's Head of AI anything about Brain² (Reddit AMA)". The changelog doubles as an announcements channel.
- **Two-level structure.** The changelog entry is the highlight; it **links out to the full release notes** for detail. [Release Notes 3.52](https://clickup.canny.io/changelog/clickup-release-notes-352) is about 250–300 words, organized by **theme** ("a ClickUp Calendar takeover!") rather than by change type, with five or six named feature subsections and no bug-fix section at all.
- **Per entry:** a custom banner image, two to four paragraphs, five to seven bulleted highlights **with emoji prefixes**, one link to fuller notes, Facebook and X share buttons, and a **like count** (2–18 observed). One Canny graphic per release note; **no video, no GIFs** observed.
- **RSS is offered.** Comments are not shown on changelog entries.
- **No links from a changelog entry back to the feature request that asked for it.**

### 2.2 The feature board — public to read, login to write, heavily categorised

[`clickup.canny.io/feature-requests`](https://clickup.canny.io/feature-requests), also served at `feedback.clickup.com`.

- **Publicly readable without login.** Writing requires one: "Log in to your ClickUp account to give feedback." Canny requires sign-in to post, vote, or comment.
- **Many boards, then many categories.** Separate boards for ClickUp Mobile, Integrations, Languages, Public API, AI Notetaker, and ClickUp Chat Feedback; the main board carries **59-plus categories**, from Automations (2,818 requests) down to Sprints (44).
- **Six statuses observed:** Future, Planned, Building Now, Beta, Completed, and **Not on the roadmap**.
- **Sort by Trending, Top, or New**; filter by status and category.
- **Vote counts are prominent** (157, 313, 2.1k on the posts sampled).
- **The voter list is public.** A post's "Voters" page lists names — "Bridget Parfitt", "Jenny", "Max Avery" — with "243 more".
- **Identity is real full names, no company shown.** "Daniel Urbano", "Camille Asselin". Staff carry a member badge. There is a separate ClickUp "verified badge" programme.
- **Threads are long-lived and staffed.** "Grouping of Spaces" was posted 4 June 2022 and was still drawing comments in January 2026, including dated replies from a badged staff member proposing workarounds.

### 2.3 The "forum" — ClickUp does not have one

This is the finding that reframes the whole request.

[`clickup.com/community`](https://clickup.com/community) lists a Facebook Group, r/clickup, X, LinkedIn, ClickUp University, webinars, events, the Canny board, and the verified-badge, affiliate, partner and consultant programmes. **There is no first-party hosted discussion forum.**

Users have asked for one, twice:

- ["ClickUp User Forum"](https://clickup.canny.io/feature-requests/p/clickup-user-forum) — filed **10 July 2018**, 48 votes, asking for "a user forum where ClickUp users can come together to answer questions and provide suggestions and ideas about how they are using ClickUp." Marked **Completed** — by the existence of the Canny board, not by a forum.
- ["How about a clickup forum"](https://clickup.canny.io/feature-requests/p/how-about-a-clickup-forum) — filed **9 August 2023**, 4 votes, asking for "an organized, searchable format with different boards." A ClickUp representative pointed to Facebook and Reddit. The poster disagreed, in terms worth quoting because they are the entire product opportunity: _"The problem is these are more like social media walls you have to scroll through rather than an organised searchable forum with different boards etc… Not great for finding answers, tips tricks etc…"_ **Closed "Not on the roadmap" on 29 August 2025.**

**So "do what ClickUp does for forums" resolves to: a category-structured, status-tracked, publicly readable board with long-lived comment threads, plus off-platform social chatter.** The instruction and the first draft's caution point at the same build. That is the reconciliation, and it is stronger than a compromise — it is what the reference product means by the word.

It also names a gap. ClickUp declined the organised searchable board and sent people to Facebook. Lawyers are exactly the audience least well served by a Facebook group, for the reason this document has been about from the start.

---

## 3. Surface one — the public changelog

### 3.1 The source already exists, and it almost holds

`CHANGELOG.md` is assembled on `main` from fragments in `changelog.d/` by `vp run changelog-build`, already written to the documentation-writing standard: user-facing language, effect not mechanism. A public changelog renders from that source. A second hand-written one would be a second home for the same fact and would drift within a month.

**It does not hold unchanged.** The corpus is 87 fragments (55 Added, 10 Changed, 13 Fixed, 1 Security). Roughly a quarter are design documents; at least fourteen say in their own words that they ship no product code. One is a per-job evaluation of moving the quality gate from GitHub Actions to Cloudflare Workers Builds, ending "Research only — no decision, no configuration changed." Correct for this repository, actively harmful for a customer. The design-only entries are worse: a public changelog describing billing before billing exists breaks **version-accuracy-by-construction**, the property ADR-0048 chose the bundled-artifact model to guarantee, in the opposite direction from the drift it guarded.

**The same source, filtered and re-voiced, never a second source.**

### 3.2 The mechanism

**A required `audience:` key** — `public` or `internal` — **with no default in either direction.** Both defaults are wrong asymmetrically: `public` publishes a research note the first time someone forgets; `internal` means the public changelog quietly stops being written and nobody notices, which is worse because it fails silently. This tree already holds the equivalent line: the status page never invents a green.

**A `## Public` block in the body of a `public` fragment.** Developer entry above, customer entry below, one file, one commit, one review. The root `CLAUDE.md` already draws exactly this boundary between developer docs and user docs.

**A new fitness function, `pnpm run lint:changelog-fragments`,** modelled on `lint:decisions`.

**Migration:** all 87 fragments get `audience: internal` in one mechanical pass. An hour today; a per-file judgement call at 800, which nobody will do.

**The rule of thumb:** a fragment describing something a user can now do is `public`; a design, decision, research finding or internal tool is `internal`. Design-only work is `internal` by definition — it has not shipped.

### 3.3 What we take from ClickUp, and what we do not

| Take                                                                                            | Leave                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Two-level structure** — a short thematic highlight entry linking to the fuller detail         | **Hosting on Canny.** Their changelog and board share one vendor, so one outage takes both; and their changelog derives from nothing |
| **A banner image per major entry**, and thematic roll-ups rather than one entry per commit      | **Emoji prefixes on bullets.** Golden rule 2 forbids emojis outright — Lucide icons instead. Stated explicitly because it is visible |
| **Likes/reactions and an RSS feed**                                                             | **A single `new` label.** Our fragments already carry Keep-a-Changelog categories, so a category filter is free                      |
| **Announcements alongside releases** (their AMA entry) — the surface is a channel, not a ledger | **No back-links.** ClickUp never links a shipped entry to the request that asked for it                                              |

**One thing we do that ClickUp does not:** a shipped entry **links back to the board post that requested it**, and that post's subscribers get an email linking to the entry. That is the loop ADR-0044 already specified — subscriber-carry plus notify on ship, never auto-authored prose — and it is free once both surfaces exist.

### 3.4 Cadence and unit

**Dated entries, not versions.** `CHANGELOG.md` has one `[Unreleased]` section and no versioned sections, so a version list would have to be invented. The artifact carries both fields; the renderer switches to version grouping when releases begin being cut. ClickUp, Vercel and Stripe all run dated entry-level changelogs.

**Public entries are curated roll-ups, not one per fragment.** ClickUp posts monthly-ish themes, not per-merge notes, and that is right: a customer wants "what changed for me," not a commit log. The `## Public` blocks are the raw material; the roll-up is authored at publish time from the accumulated public blocks.

---

## 4. Surfaces two and three — one board, two post kinds

### 4.1 The reconciliation, and where it fails

The first draft's objection rested on **ABA Formal Opinion 511R** (May 2024): Model Rule 1.6 prohibits a lawyer from posting questions or comments relating to a representation to a listserv — **even hypothetically** — without informed consent, where a reader could **then or later** infer the client's identity or the situation. The opinion addresses closed, membership-verified lists; a public indexed forum is strictly worse.

**That analysis was about lawyers discussing representations. It is not about lawyers discussing software, and the distinction is real, not a convenience.** "How do I structure custom fields for a contingency matter" has no client in it. "What is the right way to build a fee-agreement template with conditional clauses" has no client in it. "Why is trust reconciliation flagging a variance" is _about a client ledger_ but need not name one. The subject of a product-usage board is the product, and 511R has nothing to say about the product.

**So the reconciliation holds. But it holds because of structure, and it fails in three specific places, which is what the rest of this section is about.**

**Failure one — the bivalent question.** "How do I record a settlement where the client disputes the fee" is two questions wearing one sentence. Asked as _what is the workflow in Magna Carta for a disputed fee_ it is a product question. Asked with the facts attached it is practice advice with a client in it. The mitigation is that the composer makes the product framing the path of least resistance, and moderation moves the other kind.

**Failure two, and it is the serious one — screenshots.** This is where legal software is meaningfully worse than ClickUp, and it deserves to be named rather than absorbed. ClickUp's own changelog and board lean heavily on images. **A screenshot of our product contains a client name, a matter number, a ledger balance, and often opposing parties.** A lawyer answering "here is what I see" by pasting a screen capture discloses more in one image than any paragraph would, and an image cannot be skimmed by the same eye that skims text. It is the single highest-probability leak on this board.

**Failure three — the long tail of specificity.** A question specific enough to be useful is sometimes specific enough to identify. "How do I handle a trust reversal on a fee dispute in a Nevada guardianship where the ward's estate is the payor" is a product question and also very nearly a matter. There is no rule that separates these; there is only a norm, a moderator, and a fast undo.

**Verdict: build it, scoped to product usage, with structure doing the work.** The hazard is a moderation problem, as the coordinator put it — but only because the structure removes the general case first. Structure, then norms, then moderation, then undo, in that order of load-bearing.

### 4.2 Scope and category structure — the primary control

**Structure does more than rules do.** ClickUp runs 59-plus categories and separate boards. We mirror that shape and choose the taxonomy to steer.

**Every category is a product area. There is no general category, and that absence is the control.**

Trust and reconciliation · Billing and invoicing · Time and costs · Matters and organisation · Directory and conflicts · Documents and file manager · Templates, merge fields and automation · Discovery · Custodian · Calendar and docketing · Client portal · Reports · Integrations and API · Mobile and desktop · Search · Accessibility · Onboarding and migration

**Explicitly not present, and this is a design commitment rather than an oversight:** no "General", no "Off-topic", no "Practice management", no "Ask a lawyer", no "War stories", no jurisdiction categories. A practice-advice question has **nowhere to go**. The composer requires a category before it will accept a post, so every author is asked "which part of the software is this about" before they write a word — which reframes the question at the only moment reframing is cheap.

**Two post kinds on the one board**, which is how the dormant `discussion` seam from the 2026-06-17 design gets woken rather than replaced:

| Kind         | Votable                          | Status pipeline | On the roadmap | For                                                                                   |
| ------------ | -------------------------------- | --------------- | -------------- | ------------------------------------------------------------------------------------- |
| **Request**  | Yes                              | Yes             | Yes            | "The product should do X"                                                             |
| **Question** | No — answers are votable instead | No              | No             | "How do I do X", "here is a template I built", "is this the right way to structure Y" |

A question with an accepted answer is marked as such and floats to the top of the category. **A question that turns out to be a missing capability is converted to a request by an operator in one action, carrying its thread with it.** ClickUp cannot do this, because it has only one post kind — which is precisely why its 2018 forum request was closed as "Completed" by a board that answers a different question.

### 4.3 Statuses, adopted from ClickUp with one addition

**Future · Planned · Building Now · Beta · Completed · Not on the roadmap** — ClickUp's own six, which are better than the first draft's set: "Building Now" reads better than "in progress", and **Beta** maps onto the release-channels work already designed.

Added: **Duplicate** (merged, carrying votes to the target).

**Kept from the first draft, and ClickUp's board is the evidence for keeping it:** declining requires a reason from a closed set plus prose, and nothing sits untriaged past thirty days. ClickUp's board shows both failure modes in the open — a 2018 request marked **Completed** for something that was never built, and a 2022 thread still accumulating comments in 2026 with no resolution. A status that is used to close a conversation rather than to describe reality teaches readers to distrust every other status on the board.

**Auto-archive** at twelve months with no vote, with a note. Archived, never deleted.

### 4.4 Public to read, login to write — a change from the first draft

**ClickUp's board is publicly readable, and the first draft was wrong to put ours entirely behind the login.** The acquisition value is real and I under-weighted it: a prospect who sees 2,818 open automation requests with staff replying in-thread is seeing evidence that the product is alive, and that evidence cannot be manufactured by a marketing page.

**But public and indexed are different things, and the difference is the whole design.** I located ClickUp's voter list — real names, "Bridget Parfitt", "Jenny", "Max Avery" — **through a web search**. That is the mechanism of harm stated concretely: if a lawyer's name sat in a public voter list beside a request about disputed-fee trust reversals, a search engine would hold that association permanently.

So:

- **Public to read. Login (and a provisioned firm) to write.** As ClickUp does.
- **`noindex` on the entire board, permanently.** A prospect who follows a link sees it; a crawler does not keep it. This is a deliberate, evidenced departure from ClickUp, and it costs only the search traffic — which was never the point, since the changelog carries the indexable acquisition content.
- **The voter list is never public. Aggregate counts only.** ClickUp exposes theirs; this is the sharpest disagreement with the model in the whole design, and it is not close.

### 4.5 Identity — revisited, and moved

ClickUp uses **real full names with no company shown**. The first draft recommended forced verified-pseudonymity. **That moves, and the product-usage scoping is what moves it.**

With the subject scoped to the software, no general category, and a name that carries no firm, a real name attached to "how do I bulk-edit custom fields" discloses nothing at all. And **firm was always the sharper edge than name** — firm plus practice area plus question is the inference path, and name alone is not. ClickUp's own omission of company affiliation is the tell: the reference product already made the choice that matters.

**Recommendation:**

- **Real display name by default, suggested at profile creation.** As ClickUp does.
- **An account-level pseudonym is permitted as a setting.** This is not the per-post choice the first draft rejected, and the distinction holds: a persistent handle raises no "why did they hide _this_ one" signal, because there is no per-post decision to read.
- **The firm is never displayed.** Not by default, not opt-in. Held on the record for ranking and moderation, rendered never.
- **A verified badge** for staff and, later, for ambassadors — ClickUp runs exactly this, and it supplies the credibility that anonymity would destroy without supplying identity.

**Confidence: moderate-high.** Higher than the first draft's on the answer, lower on the reasoning, because it depends on the category structure actually holding the scope. If a "General" category ever appears, this identity model becomes wrong again, and that dependency should be written into the category decision rather than remembered.

### 4.6 The posting-time notice — kept, reworded

Keep it, and change what it says. In a product-usage context "do not post about a representation" is the wrong frame — it is abstract, it invites a judgement call, and it is about a duty the reader already has. The useful notice is **operational and about this board**:

> This board is about the software. Do not include client names, matter numbers, ledger balances, party names, or screenshots of your own data — a question that needs those belongs in support, where it stays confidential. _(ABA Formal Opinion 511R holds that a post can breach confidentiality even in hypothetical form, where a reader could infer the client or the situation.)_

- **Shown on first post, dismissible forever.** A modal on every post is patronising, blind within a week, and legally worthless.
- **The last clause stays** — one line, cited, for the reader who wants the authority. The thing practitioners do not know is not "be careful"; it is that a hypothetical counts.
- **A permanent one-line statement beside the composer** giving the venue's facts: publicly readable, not indexed, removable instantly by you.
- **A "send this to support instead" control on the composer itself**, because the notice tells the author their question is in the wrong place and must therefore offer the right one in the same gesture.

### 4.7 Attachments — disabled at launch

**No image or file attachments on board posts in v1.** Rich text, formatted lists, and code or formula snippets, yes.

This is the direct answer to failure two, and it is a real cost honestly taken: "here is a screenshot of what I see" is the most natural way to ask a software question, and removing it makes the board worse. It is taken anyway because our screenshots are the worst case, because an image defeats every text-based control on the board at once, and because the alternative — routing images through the scrub and metadata machinery the platform already has — is a heavy build for a v1 board with no traffic. The composer's "send to support" control is what absorbs the demand. Revisit once there is moderation capacity and a measured need.

---

## 5. Where these live

### 5.1 The owner's hierarchy

| Tier                 | What sits there                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Login**            | Unchanged                                                                                                                                                    |
| **Main application** | Deep links into the board, the in-app updates route, the "What's New" badge, and the "send to support" path                                                  |
| **Other**            | **The public changelog** and **the community board** (public to read, login to write); the status page (shipped); marketing; documentation; the trust center |

The first draft put the board in _main application_. **It moves to _other_, because it is now publicly readable** — which is the owner's own placement for forums, and matches the reference product.

### 5.2 Deployables

**The public changelog needs no compute:** a Workers static-assets deployment with no `main` and no bindings. More fate-isolated than the status worker, which at least reads KV.

**The community board is its own worker** — `apps/community-worker` — binding the control-plane database and validating sessions minted by Better Auth. It is its own deployable rather than routes on `apps/worker` for three reasons: it is the only surface in the estate that serves **unauthenticated public reads of user-authored content**, so its blast radius should not be the application's; its availability is not load-bearing for a firm doing billable work; and the `@magna-carta/community` package boundary from the 2026-06-17 design — no firm-scoped data-access layer, no per-firm binding, enforced by a fitness function — is much easier to hold when the deployable cannot reach those bindings at all. **The isolation is the confidentiality boundary**, and a separate worker makes it a property of the deployment rather than a property of a lint rule.

This is a change from the first draft, which put the board in `apps/worker`. Public read is what changed it.

**No Durable Object anywhere.** Vote counting is a unique constraint on `(postId, userId)` plus a denormalized counter; thread reads are ordinary queries. A Durable Object would add a migration lifecycle and a stateful deploy to a workload with neither coordination nor contention. **The preview-URL constraint the owner raised is real and costs nothing here** — all thirteen workers in `apps/` already set `preview_urls: false`, so no workflow depends on them. The reason to avoid a Durable Object is that nothing needs one, not the preview URLs.

### 5.3 The domain question — recommendation, still needs the owner

The owner states `magna-carta.com` is marketing and `magnacarta.esq` is the product. The white paper's _Delivery model_ hosts table puts marketing, the help center, intake **and the public product-updates pages** on `magnacarta.esq`/`www`. Those are not the same plan, and the changelog is the page they disagree about.

**Recommendation, now firmer because it is blocking: both the changelog and the board go on `magnacarta.esq`** — `changelog.magnacarta.esq` and `community.magnacarta.esq`, beside the already-shipped `status.magnacarta.esq`.

Three reasons. Status, changelog and board are one trust surface — a reader checking what broke, what changed, and whether anyone else has hit it is usually the same person in the same ten minutes. Splitting them across two registrable domains halves the credibility of both and doubles the routing and certificate surface. And the reference product agrees: ClickUp serves its board at `feedback.clickup.com` and its changelog on the same Canny host, both product-side, not on a marketing microsite.

The cost is that search value accrues to the product domain — small, and smaller still given the board is `noindex` by design. **A published URL is permanent, so this is settled before the first public page ships.**

---

## 6. Spam, abuse, and what happens when someone posts a real matter

**The platform does not moderate at 3am. Two different things happen instead, and they are different because the two failures are not alike.**

### 6.1 Spam and abuse — degrade

1. **Writing requires a provisioned firm.** A spammer must complete email verification, Turnstile, and the registration flow before posting once. The highest-value control in the list, and already built. It is also the anti-astroturf control, and stronger than real names, which do not stop a competitor's employee signing up under their own.
2. **First-post pre-moderation.** A profile's first post and first comment are held until approved; after one approval the account posts freely. Nothing from a brand-new account is publicly visible before a human sees it.
3. **Turnstile plus per-account and per-firm rate limits** on every write.
4. **A read-only kill switch in KV** — one operator write, no deploy, every write endpoint returns a stated refusal. **Built with the first write endpoint**: twenty lines then, a pass across every route later, under pressure, during the incident that needed it.
5. **Spam and abuse reports need N reports from N distinct firms** to hide a post, which bounds report abuse using the `firmId` the ranking already carries.

### 6.2 Confidentiality — remove first, ask later

**This is a policy inversion from normal moderation and it is deliberate.** Ordinary moderation queues and reviews. Here the asymmetry is extreme: a false positive costs a lawyer an eight-hour wait for their template question; a false negative is a permanent disclosure of a client relationship. So a post suspected of carrying client detail is **hidden immediately, automatically, before review** — and restored if the review clears it.

Four detectors, in descending order of how much work they actually do:

1. **The author.** Self-service delete is **one click, instant, complete, no operator, no queue** — the body is gone in one write. The author is the fastest and most frequent detector, usually within minutes, and everything else exists to catch what they miss. This is why removal was designed as one write rather than a distributed erasure.
2. **Any reader, with one click.** **A single confidentiality flag from any authenticated user hides the post pending review** — not the N-distinct-firms threshold, which is right for spam and wrong here. Abuse of the flag is bounded because a cleared post returns and repeat false flagging is visible on the account.
3. **A conservative format detector on every post, not just first posts.** Format-shaped signals only — strings shaped like matter numbers or docket numbers, case captions containing " v. ", currency figures adjacent to proper nouns, email addresses, phone numbers. **It never consults firm data**: the package may not bind a per-firm database, and checking a post against the poster's own Directory would cross exactly the boundary the fitness function exists to hold. Format-only means more false positives, which the remove-first posture makes affordable.
4. **The moderator, at 9am.** Restores, redacts, or removes permanently.

**So the honest answer to "what does the platform do at 3am" is: the post is already hidden — by its author, by a reader, or by the detector — and a human decides at 9am.** That is a real answer rather than a staffing promise, and it is the reason the removal rules in section 7 are load-bearing rather than hygiene.

### 6.3 Who

**The owner moderates.** Written down, because a design that assumes a community team fails on a Saturday. Everything above exists so the standing cost is minutes per week. **If it ever exceeds that, the correct response is to narrow the surface, not to hire** — and the surface is narrowable: categories can close, questions can be disabled leaving only requests, and the kill switch exists.

---

## 7. Expensive to retrofit — decide now, build later

| Decision                                                                             | Why now                                                | Cost of retrofit                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **`audience` on every changelog fragment, required, no default**                     | 87 fragments today, all mechanically `internal`        | A judgement call per file at 800; nobody will do it                                             |
| **`noindex` on the whole board, permanently, from the first byte**                   | One header                                             | Impossible. ClickUp's voter list is findable by search today, which is the demonstration        |
| **The voter list is never rendered, only counted**                                   | A rendering decision                                   | Impossible once published, and it is the specific harm the identity model exists to prevent     |
| **`firmId` on every vote and post, at write time**                                   | One column                                             | Unreconstructable — firm membership changes, so it cannot be derived later                      |
| **No "General" category, ever**                                                      | A taxonomy decision, free today                        | Adding one is easy and removing one is not; the identity model depends on its absence           |
| **Author delete is one click and one write — the body has exactly one home**         | A structural constraint, free at the start             | Removal becomes a distributed erasure that half-fails silently                                  |
| **Notification emails link, never quote**                                            | A rule with no code cost                               | Impossible. A quoted body sits in inboxes forever; you cannot unsend                            |
| **No target-date field in the roadmap schema — absent, not nullable**                | The cheapest thing to build is the thing not built     | A nullable column gets populated, and then it is a promise                                      |
| **Portal external principals excluded structurally, not by a permission check**      | The surfaces already differ by host and principal type | One refactor from being wrong, and the failure discloses a firm-client relationship             |
| **A read-only kill switch in KV, built with the first write endpoint**               | Twenty lines                                           | A pass across every route, done under pressure                                                  |
| **Community profile is a separate record; display name is never the account column** | One table                                              | A rename touching every read path, with a window where real names were already shown            |
| **Public post numbers from a real sequence**                                         | The sequence-numbering package exists                  | URLs are permanent; a row identifier leaks volume and cannot be changed once published          |
| **Edit history is never public**                                                     | A rendering decision                                   | A lawyer editing an over-identifying post must not leave the original visible                   |
| **Attachments off at launch**                                                        | Not building a feature                                 | Turning off an existing upload path is a visible removal, and the images already posted persist |

---

## 8. Considered and rejected

- **A general discussion forum** — an "ask other lawyers" space. Still rejected, and now with the reference product as the evidence: **ClickUp does not have one, closed the request for one "Not on the roadmap" in August 2025, and sends people to Facebook and Reddit.** "Build what ClickUp does" and "do not build a general forum" turn out to be the same instruction. The 511R analysis applies to that space and only to that space.
- **Hosting on Canny, as ClickUp does.** Already rejected in ADR-0044 for per-tracked-user cost-scaling; two further reasons now. Their changelog and board share one vendor, so one outage takes both. And member content would sit outside our removal path, which section 6.2 makes non-negotiable — a one-click instant delete is not something a third party's board can promise us.
- **A public voter list.** ClickUp has one; it is findable by search; it is the exact disclosure vector this design exists to close.
- **Indexing the board for acquisition value.** Irreversible, and the changelog already carries the indexable content.
- **Forced pseudonymity** (the first draft's recommendation). Withdrawn: the product-usage scoping and the absence of a displayed firm remove the harm it was protecting against, and it costs the credibility that makes an answer worth reading.
- **Per-post identity choice.** Still rejected — once disclosure is optional per post, non-disclosure becomes a signal. Account-level choice does not have this property.
- **Displaying the firm, even opt-in.** Firm plus practice area plus question is the inference path. ClickUp shows no company either.
- **Attachments at launch.** Rejected above, with the cost stated.
- **A confidentiality modal on every post.** Patronising, blind within a week, legally worthless.
- **Dropping the 511R citation entirely for the product-usage framing.** Rejected: the operational rule leads, but the one-line citation is what makes it authoritative to the audience, and the bivalent question in section 4.1 means the duty has not actually gone away.
- **N-distinct-firm thresholds for confidentiality flags.** Right for spam, wrong here — one flag hides.
- **Consulting firm data to detect client names in posts.** Would cross the per-firm boundary the package fitness function exists to hold. Format-only detection, and accept the false positives.
- **One firm, one ballot.** Disenfranchises the paralegal who feels the cost most; distinct-firm ranking gets the anti-stuffing property without it.
- **Revenue- or plan-weighted voting.** Recommended by the B2B literature, but a bigger cheque buying more influence is per-seat cost-scaling in a different coat. `firmId` is the seam, so the reversal stays free.
- **Emoji prefixes on changelog bullets**, as ClickUp uses. Golden rule 2 forbids emojis; Lucide icons instead.
- **Publishing `ROADMAP.md` verbatim.** Internal execution tracking in slice and phase vocabulary; outside this repository it reads as a schedule.
- **A Durable Object for vote counts or thread state.** A unique constraint plus a counter suffices.
- **Putting the board in `apps/worker`** (the first draft's placement). Public read of user-authored content should not share a blast radius with the application, and package isolation is stronger as a deployment property than as a lint rule.

---

## 9. Open questions for the owner

1. **Domain — blocking.** `magna-carta.com` or `magnacarta.esq` (section 5.3). Recommended: `magnacarta.esq`, beside status. Settle before the first public URL exists.
2. **Whether questions launch with requests or a slice later.** They share everything; the argument for splitting is that the request board's moderation load is knowable and the question board's is not.
3. **Verified badge granularity.** ClickUp badges staff only. A badge specific enough to be useful ("verified trusts and estates attorney") can reconstruct the identity a pseudonym exists to hide.
4. **Whether declined requests can be re-opened by vote.** Recommended: no automatic mechanism; "not on the roadmap" with a stated condition handles it explicitly.
5. **Attachments** (section 4.7) — the recommendation is off at launch, and it is the one recommendation here most likely to be wrong in practice.

---

## 10. Decision summary

1. **Public changelog first, alone**, rendered from `changelog.d/` — the same source, filtered and re-voiced, never a second source.
2. **`audience` becomes a required fragment key with no default**; `public` fragments carry a `## Public` block; a fitness function enforces both; 87 fragments migrate to `internal` in one pass.
3. **Dated entries, curated into thematic roll-ups**, two-level as ClickUp does, with likes and RSS — but self-hosted, category-filterable, emoji-free, and **linking back to the request that asked for it**, which ClickUp does not.
4. **The board is public to read and login-to-write, as ClickUp's is** — and **`noindex` permanently, with the voter list never rendered**, which ClickUp's is not.
5. **One board, two post kinds** — requests (votable, status pipeline, roadmap) and questions (threaded, votable answers). A question converts to a request in one operator action. This wakes the dormant `discussion` seam rather than replacing it.
6. **Categories are all product areas and there is no "General."** The absence is the primary control, and the identity model depends on it.
7. **ClickUp's six statuses adopted** — Future, Planned, Building Now, Beta, Completed, Not on the roadmap — plus Duplicate. **Declining requires a reason**, thirty-day triage clock, twelve-month auto-archive: ClickUp's board demonstrates both failures.
8. **Real display name by default, account-level pseudonym permitted, firm never displayed, verified badge for staff.** A move from the first draft, caused by the product-usage scoping and by ClickUp showing no company either.
9. **`firmId` on every vote; rank by distinct firms** with a display floor of five. Revenue weighting rejected, seam kept. **Portal external principals excluded structurally.**
10. **No target-date field in the roadmap schema.** Three columns, no dates, a standing note that cards move backwards.
11. **Spam degrades; confidentiality removes first and asks later.** One-click author delete, single-flag hide, a format-only detector that never touches firm data, and a read-only kill switch built with the first write endpoint.
12. **No attachments at launch**, with "send this to support instead" on the composer.
13. **Changelog is static assets with no bindings; the board is its own worker (`apps/community-worker`); no Durable Object.** The preview-URL constraint is already priced in repo-wide.
14. **Still not built: a general discussion space.** ClickUp does not have one either, and closed the request for one in August 2025.

---

## Sources

**ClickUp surfaces, studied 2026-08-11:** [Changelog](https://clickup.canny.io/changelog) · [Release Notes 3.52](https://clickup.canny.io/changelog/clickup-release-notes-352) · [Feature Requests board](https://clickup.canny.io/feature-requests) · [Grouping of Spaces (identity, voter list, thread longevity)](https://clickup.canny.io/feature-requests/p/grouping-of-spaces-1) · ["ClickUp User Forum" request, 2018](https://clickup.canny.io/feature-requests/p/clickup-user-forum) · ["How about a clickup forum", closed Not on the roadmap 2025](https://clickup.canny.io/feature-requests/p/how-about-a-clickup-forum) · [ClickUp Community](https://clickup.com/community) · [Share your feedback with ClickUp](https://help.clickup.com/hc/en-us/articles/6327848986775-Share-your-feedback-with-ClickUp)

**Ethics:** [ABA Formal Opinion 511 (FW Law)](https://www.fwlaw.com/insights/aba-issues-formal-ethics-opinion-511-on-confidentiality-obligations-of-lawyers-posting-to-listservs) · [Alameda County Bar Association](https://www.acbanet.org/2024/05/23/understanding-aba-formal-opinion-511-confidentiality-obligations-when-using-listservs/) · [The Florida Bar](https://www.floridabar.org/the-florida-bar-news/aba-issues-ethics-guidance-on-a-lawyers-use-of-listservs-particularly-for-pending-matters/)

**Practice:** [Canny on feature voting](https://canny.io/blog/feature-voting-best-practices/) · [ProductLift](https://www.productlift.dev/blog/feature-voting-best-practices) · [Heedback on public roadmaps](https://www.heedback.io/en/blog/public-roadmap-best-practices) · [SaaS PM](https://www.saaspm.com/p/should-i-publicly-share-a-saas-startups) · [i4a, ghost-town forums](https://www.i4a.com/blog/online-member-forums-best-practices/) · [Akismet on forum spam](https://akismet.com/blog/forum-spam/) · [Clio Law Community](https://community.clio.com/) · [Vercel](https://vercel.com/changelog) · [Linear](https://linear.app/changelog) · [Stripe changelog review](https://buildtogether.substack.com/p/stripe-changelog-review)
