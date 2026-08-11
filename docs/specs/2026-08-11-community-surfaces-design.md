# Community surfaces — public changelog, feature voting, and forums — design

**Status:** Proposed (design) · **Date:** 2026-08-11 · **Owner:** Trevor Goldsmith
**White-paper home:** _Community & feedback forum_ and _Product updates (changelog, release notes & roadmap)_
**Builds on:** [`2026-06-17-community-feedback-board-design.md`](2026-06-17-community-feedback-board-design.md) (ADR-0044, amended — native `@magna-carta/community` build), ADR-0048 (product updates), [`2026-07-02-service-status-design.md`](2026-07-02-service-status-design.md) (the isolated public read worker, shipped), [`2026-08-10-self-serve-firm-provisioning-and-entitlements.md`](2026-08-10-self-serve-firm-provisioning-and-entitlements.md) (the free tier, Turnstile, the registration surface)
**Decisions proposed:** `community-surfaces-sequencing`, `public-changelog-audience-and-source`, `community-surface-placement`, `community-identity-and-vote-eligibility`, `community-moderation-and-removal-posture`
**Produces:** this design and its decision fragments. **No product code, no schema, no package, no route.**

---

## 1. Recommendation, ranked

Three things were asked for. They are not one thing, they carry very different risk, and they should not ship together.

| Rank | Surface              | Value                                                                                                 | Effort                                                                    | Risk                                                                                               | Verdict                                                         |
| ---- | -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1    | **Public changelog** | High and immediate — credibility, acquisition, and the public half of a surface the app already needs | **Low.** The source exists and is already written in user-facing prose    | **Near zero.** No writes, no accounts, no user content, nothing to moderate                        | **Build first, alone.**                                         |
| 2    | **Feature voting**   | Real, but scales with the number of firms. At one tenant a vote count is noise                        | **Medium.** Schema, write path, triage tooling, an operator queue         | **Medium.** Commitment pressure, a board that goes silent, a moderation surface                    | **Build second, login-gated, inside the app.**                  |
| 3    | **Forums**           | **Unproven, and the demand splits into two halves that are each better served elsewhere**             | **Highest.** Everything voting needs, plus threads, plus a permanent duty | **Highest.** A confidentiality hazard the other two do not have, and an unbounded operational cost | **Do not build. Build the knowledge base and support instead.** |

**Sequencing.** Public changelog now. Feature voting next, but gated on the platform having enough firms for a vote to mean anything. Forums not on the roadmap; the dormant `discussion` seam that the 2026-06-17 design already put in the data model stays dormant, and the decision to wake it is re-taken against named conditions rather than inherited.

**Why this is one document and not three.** The three surfaces ship independently, but the decisions that bind them — who may hold a community identity, where these live, what the platform does at 3am, and what is impossible to retrofit — are shared. Three documents would state those three times, which is the drift the one-home-per-fact rule exists to prevent. Each surface gets its own section and its own decision fragment, so any one of them can be built or dropped without disturbing the others.

---

## 2. Surface one — the public changelog

### 2.1 The source already exists, and it almost holds

`CHANGELOG.md` is assembled on `main` from per-entry fragments in `changelog.d/` by `vp run changelog-build`. The fragments are already written to the documentation-writing standard: user-facing language, effect not mechanism, imperative present. That is not an accident of style — it is the standing rule, and it is why a public changelog should render from this source rather than becoming a second thing to maintain. A second hand-written public changelog would be a second home for the same fact, would drift within a month, and would break the version-accuracy-by-construction property ADR-0048 exists to hold.

**But it does not hold today, and the reason is worth being precise about.** The corpus at the time of writing is 87 fragments (55 Added, 10 Changed, 13 Fixed, 1 Security). Roughly a quarter of them are design documents, and at least fourteen say in their own words that they ship no product code. Others are pure research. One reads:

> **Research: can the quality gate run on Cloudflare instead of GitHub Actions?** … Records two findings worth keeping regardless: Workers Builds ships an **undocumented Docker daemon** … Research only — no decision, no configuration changed.

That is a correct and valuable changelog entry for this repository and an actively harmful one for a customer. It is not merely uninteresting — it advertises a competitor evaluation, it describes work that changed nothing a user can touch, and read as a product changelog it says the team spends its time on build infrastructure. The design-only entries are worse still: a public changelog that describes billing before billing exists breaks the one property the bundled-artifact model was chosen to guarantee, in the opposite direction from the one ADR-0048 worried about.

So: **the same source, filtered and re-voiced, never a second source.**

### 2.2 The mechanism — a required `audience`, and public prose in the same file

Two changes to the fragment contract.

**A required `audience:` key.** `public` or `internal`. Not optional and **with no default in either direction**, because both defaults are wrong: defaulting to `public` publishes research notes on the first day someone forgets, and defaulting to `internal` means the public changelog quietly stops being written and nobody notices, which is the worse of the two because it fails silently. This repository already holds the equivalent line elsewhere — the status page never invents a green, and absence of evidence is not evidence of health. A fragment that has not decided its audience fails the build.

**A `## Public` block in the body of a `public` fragment.** The developer entry stays where it is; the user-facing entry goes below the marker, in the same file, in the same commit, reviewed together. This is not duplication in the sense the golden rules prohibit — the root `CLAUDE.md` already draws exactly this line between developer docs and user docs: different facts for different readers, no shared sentences to drift, one commit. A fragment marked `public` with no public block fails the build.

**Enforcement** is a new fitness function, `pnpm run lint:changelog-fragments`, modelled on the existing `lint:decisions`: same shape, same posture — fail in the author's own pull request where the fix is one edit, rather than in assembled output on `main`.

**Migration** is one mechanical pass adding `audience: internal` to all 87 existing fragments. That pass costs an hour today. It is the single clearest reason to make this decision now rather than later: at 800 fragments it is a judgement call per file, and nobody will do it.

**Who decides.** The author proposes at write time; the owner confirms at merge, which is a line to read in a diff, not a separate review step. The rule of thumb is stated once and is checkable by a human in a second: **a fragment describing something a user can now do is `public`; a fragment describing a design, a decision, a research finding, or an internal tool is `internal`.** Design-only work is `internal` by definition — it has not shipped.

### 2.3 What the public changelog is a list of

**No releases have been cut.** `CHANGELOG.md` has a single `[Unreleased]` section and no versioned sections at all. A public changelog cannot therefore be a list of versions today, and pretending otherwise would mean either inventing versions or publishing nothing.

**Recommendation: publish dated entries, not versions, until versioning begins.** The artifact schema carries both a date and an optional version, so nothing is reshaped when releases start being cut — the renderer switches from grouping by date to grouping by version. Vercel and Stripe both run a dated, filterable, entry-level changelog rather than a version list, which is the shape that reads best for a continuously deployed product anyway.

Grouping and filtering follow the same practice: filter by category (the Keep a Changelog categories are already the fragment's own vocabulary) and, later, by product area. No filter UI is needed in the first build.

### 2.4 Reach

The changelog is the surface the entire `changelog.d` discipline has been paying for since the repository started, and it is the cheapest of the three by a wide margin. It also unblocks two things already built and waiting: the `changelog` entry in the app's ecosystem-site registry (`apps/web/src/lib/navigation/ecosystem-sites.ts`), which today renders disabled with a "Soon" badge, and the in-app `/updates` route of ADR-0048, which reads the same artifact from the bundle. **One artifact, two renderers, one source.**

---

## 3. Surface two — feature voting

### 3.1 The board is an in-app surface, not a public website

This is the largest departure from the 2026-06-17 design, and it makes almost everything else easier.

**Recommendation: the feature board is login-gated for read as well as write, and lives inside the application.** In the owner's own hierarchy — login, then main application, then other — the board sits in _main application_, not in _other_. Four reasons, each independently sufficient:

1. **A logged-out board is a page full of member-authored content that we have just decided must never be indexed** (see the retrofit table). A public page nobody may index and nobody may find has no acquisition value; it has only the risks.
2. **It deletes the anonymous-read abuse surface entirely** — scraping, enumeration, and the whole class of "someone found the board and posted a wall of spam" problems that need an unauthenticated rate-limiting design.
3. **A complete public list of everything your customers wish your product did is competitive intelligence you are giving away for free**, and there is no corresponding upside; the transparency benefit is captured by the changelog and by a curated roadmap, both of which we control.
4. **It removes the public identity problem from voting completely.** Inside the app, behind a session, among verified firms, the confidentiality calculus of section 4 barely applies — a feature request is a statement about software, not about a matter.

The public-facing "here is what is coming" need is met by a **curated roadmap projection published on the public changelog surface**: three columns, no vote counts, no author attribution, hand-selected. That is the half of the board that is safe to publish, and it is the only half worth publishing.

### 3.2 Identity, and how one firm does not get a hundred ballots

Community identity **reuses Better Auth on the control-plane database** — a `community_profile` row keyed to the account, never a second account system. That was already decided (ADR-0044) and this design does not disturb it. What it adds is who qualifies.

Three people were named, and they get three different answers.

| Claimant                                       | Authenticates on                                                    | Board access                     | Why                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Staff at a firm** (lawyer, paralegal, admin) | The app, control-plane Better Auth                                  | Full — read, post, vote, comment | They are the users. A paralegal feels a workflow's cost more sharply than the partner does, so the vote is not restricted to lawyers                                                                           |
| **A client of a firm**                         | `portal.magnacarta.esq`, a distinct external-principal auth surface | **None, structurally**           | A firm's client appearing in any cross-firm list is a disclosure of the firm-client relationship — the exact confidentiality failure this whole design exists to prevent, caused by us rather than by a lawyer |
| **A prospect evaluating the product**          | Nothing, or the self-serve free tier                                | Reads the public changelog only  | No third account type. If prospect input is wanted, the free tier is the door — and requiring provisioning is simultaneously the strongest anti-astroturf control available                                    |

**Never build "any authenticated principal may participate."** The portal exclusion has to be structural rather than a permission check, because a permission check is one refactor away from being wrong, and the failure is not recoverable. The two surfaces already use different principal types on different hosts, so the exclusion costs nothing today and is expensive to impose later.

**Requiring a provisioned firm to write is the anti-astroturf control.** It is far stronger than real names — a real name does not stop a competitor's employee signing up under their real name — and far stronger than any CAPTCHA, because it demands email verification, Turnstile, and completion of the registration flow before a single post is possible.

**One vote per user; ranking by distinct firms.** Store `firmId` on every vote and every post at write time. Rank the board by **the number of distinct firms**, not the number of votes, and display both: "42 votes from 17 firms." This is the honest answer to the hundred-ballots problem, and it is better than one-firm-one-ballot, which disenfranchises the people who actually do the work. A hundred votes from one firm rank exactly as high as one.

Search on B2B voting practice recommends going further and weighting votes by plan or revenue. **Rejected for v1** on principle: this platform's stated reason to exist is escaping per-seat cost-scaling, and a board where a bigger cheque buys more influence is that same thing in a different coat. The seam is free — `firmId` on the vote row is precisely what a later weighting would need — so rejecting it now costs nothing and reversing it later costs nothing either.

**Displaying the distinct-firm count has a floor.** Below five distinct firms, show the vote count only. "Two firms want this" beside a post body written by a nameable person is a small correlation surface, and it is cheap to never create.

### 3.3 What happens to a request that will never be built

This is the part every feedback board gets wrong, and the failure is always the same: a post from four years ago with three hundred votes, still marked open, never answered. That is worse than a no, because it is a no delivered by silence, and it teaches every reader that posting is pointless.

- **`declined` is a first-class, public, permanent act that requires a reason.** A closed set — out of scope; conflicts with a rule we hold (for instance, anything that would put privileged content in a third-party service); already possible, here is how; not now, and here is what would change that; needs more firms wanting it — plus prose. The post stays visible and searchable forever. A declined request that is honestly declined is a better advertisement than a silent one.
- **Nothing sits in `open` past thirty days without a triage decision**, surfaced as an operator queue. The queue is the mechanism; discipline is not the strategy.
- **`open` with no vote in twelve months auto-archives with a note.** Archived, never deleted — the record of having asked survives.

### 3.4 Does a public roadmap create commitments the platform cannot keep

Yes, if it is built the usual way. The consistent finding across the practice literature is that dated public roadmaps produce broken-promise coverage, customer churn on slips, and internal pressure not to change scope, and that the mitigations are structural: no dates, coarse horizons, themes rather than commitments.

Applied here, structurally rather than as guidance:

- **There is no target-date field in the schema. Not nullable, not optional — absent.** A nullable date column will be populated, by someone, in a moment of optimism, and after that the column is a promise. The cheapest thing to build here is the thing we do not build.
- **Three columns and no more:** planned, in progress, shipped. This is the roadmap-as-a-filtered-view-by-status that the 2026-06-17 design already specified; it needs no new store.
- **`ROADMAP.md` is never published verbatim.** It is internal execution tracking, it carries slice and phase vocabulary that means nothing outside this repository, and outside it reads as a schedule. The public roadmap is a hand-curated projection.
- **Every column carries a standing line** stating that a card is an intention, that cards move backwards, and that shipping order changes. Said once, permanently, in the surface — not in a blog post nobody re-reads.

---

## 4. Surface three — forums

### 4.1 The confidentiality problem is real, it is documented, and it is worse than it looks

A lawyer asking a practical question can disclose the existence of a matter, a client relationship, or a dispute. The duty attaches to far more than privileged content — the fact of a representation is itself usually confidential. This is not a cautious reading; it is the express subject of a 2024 ABA ethics opinion, and the opinion is stricter than most people expect.

**ABA Formal Opinion 511R (May 2024), "Confidentiality Obligations of Lawyers Posting to Listservs."** Model Rule 1.6 prohibits a lawyer from posting questions or comments relating to a representation to a listserv — **even in hypothetical or abstract form** — without the client's informed consent, where there is a reasonable likelihood that the post will disclose information allowing a reader, **then or later**, to infer the client's identity or the situation. And obtaining that consent is not a formality: the lawyer must ordinarily explain to the client that their identity and the details of their matter may reach people who have no duty to keep them confidential and who may represent adverse interests.

Three consequences follow, and each of them cuts against a product forum specifically.

**The test is about the client, not the lawyer.** Pseudonymity does not cure it. A handle helps a great deal in practice, because inference usually runs from the lawyer to their practice to their known clients — but the opinion's test is inferability of the client or the situation, and a sufficiently specific question is identifying regardless of who signed it. **The platform must never present pseudonymity as a safe harbour**, and a design that implies one is worse than a design with no protection at all, because it invites the post that would not otherwise be made.

**A public forum is strictly worse than the listservs the opinion is about.** Those are closed, membership-verified lawyer lists. A public, search-indexed, permanent forum is the same hazard with a larger and unbounded audience and no verification of who is reading. If the opinion restricts the closed case, it forecloses the open one.

**The residual risk is not fixable by any identity model.** The lawyer's own client, reading a post about their own matter, recognises it whatever the handle says. That is the single strongest argument that the useful protection is a fast, real removal path and an honest statement of the actual test — not a warning banner.

### 4.2 The demand splits into two halves, and neither half is forum-shaped

Sort the questions a forum would carry:

**Product questions** — "how do I set up a Nevada trust account," "how do I record a settlement in the ledger," "what does this reconciliation warning mean." These are safe, they have one correct answer, and that answer should be written once by us and found by everyone. **That is a knowledge base**, which the platform is already committed to building (the help center, under _User-facing documentation_). A forum answers them worse: N approximate answers of varying vintage, the top one wrong after the next release, and no owner.

**Practice questions** — "how do I handle a client who disputes the fee." These are the ones people most need to ask, they are exactly what Formal Opinion 511R restricts, and they are already served by bar-association listservs and closed practice groups where membership is verified and the audience is bounded. **We cannot replicate that** — we cannot verify bar admission at scale, we cannot bound the audience of a public page, and we have no standing to host legal discussion between lawyers about their clients. Being the software vendor in the room makes it worse, not better.

What is left is the genuinely interesting middle: product-specific, practice-adjacent workflow questions. That band is real, and it is thin. **It is served by curated question-and-answer that we author from support volume** — the same content, none of the risk, and, decisively, **it can be started today from support tickets, and the volume of those tickets is the measurement that tells us whether forum demand exists at all before anything is built.** Measure before optimizing applies to product surfaces too.

### 4.3 The confidentiality-safe venue already exists, and it is called support

The insight that settles this: **a lawyer can already tell us things they cannot tell the internet.** The platform is the firm's data processor under an engagement — it already holds the matter, the ledger, and the documents. A private support channel therefore has no confidentiality problem at all; the relationship that makes the forum hazardous is the same relationship that makes support safe. The private diagnostics and bug-reporting pipeline already designed under _Observability and diagnostics_ is that channel, and the one-way escalation bridge from a private report to a public feature request — already accepted in ADR-0044 — is exactly the right valve: the confidential half stays private, and only what the lawyer chooses to make public becomes public.

### 4.4 Critical mass, and why an empty forum is worse than no forum

The platform has one tenant. A forum launched into that is an empty room, and an empty forum is not neutral — it is a public page asserting that nobody uses this product, on a domain we are trying to make credible. It is also unusually hard to retreat from: closing a forum is a visible admission, whereas a knowledge base that grows slowly just looks like a knowledge base.

This argument is independent of confidentiality. Even if the ethics analysis came out the other way, the sequencing answer would be the same.

### 4.5 What happens at 3am

Nobody is on call. There is no community team and there will not be one, and any design that assumes otherwise is a design that fails on a Saturday. For a public forum the load is unbounded: open registration, open posting, spam that arrives in waves, and abuse that arrives when someone decides to make it arrive. **That is the operational argument, and it is not a footnote — it is the reason the two surfaces that do get built are shaped the way they are.**

### 4.6 The recommendation, and the conditions that would change it

**Do not build the forum.** Build the knowledge base and the private support channel, keep the `discussion` seam dormant in the data model where the 2026-06-17 design already put it, and re-take the decision — not inherit it — against three named conditions, all of which must hold:

1. Enough firms that a thread would have readers, and demonstrated demand in the form of support volume that is peer-answerable rather than vendor-answerable.
2. A named human who owns moderation as part of their job, not as an interruption.
3. Content demand that is product-specific and practice-adjacent, evidenced from the support corpus — not general legal discussion, which is not ours to host.

**If it is ever built,** the shape is fixed now, because these are the parts that cannot be added afterwards: login-gated read, `noindex` permanently, verified-pseudonymous identity, no firm displayed, first-post pre-moderation, and the read-only kill switch. It gets its own deployable on its own host, precisely so it can be turned off without touching the product.

### 4.7 Identity, if it is ever built — the recommendation

**Verified-pseudonymous. Not real names, not free anonymity, and not a per-post choice.** A public handle, backed by a verified account the platform holds and moderators can resolve, with a coarse verified badge and **the firm never shown**.

| Model                     | What it costs                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Real name and firm**    | Kills the question set that motivates a forum. Every post becomes a marketing act, so the forum fills with positioning and empties of questions. It also sits closest to the Formal Opinion 511R hazard: firm attribution is the inference path                                |
| **Free anonymity**        | Astroturfing is one signup away, moderation becomes whack-a-mole against an unbounded account supply, and — subtly but fatally — the content loses value, because a legal answer from nobody is worth nothing                                                                  |
| **Verified-pseudonymous** | Accountability without exposure. The cost is that the platform holds the mapping, making it a subpoena and breach target — mitigated by the mapping being the ordinary account record already held rather than a new secret, and by a published disclosure policy in the terms |
| **Per-post choice**       | Rejected outright: once disclosure is optional, non-disclosure becomes a signal, and the pressure to disclose that the design exists to remove comes straight back                                                                                                             |

**Confidence: high** that real-name-and-firm is wrong and that per-post choice is wrong. **High** that verified-pseudonymous is the right resolution if a forum is built at all. **Moderate** on the badge design — a badge that is too specific ("verified trusts and estates attorney, Nevada") reconstructs enough of the identity to defeat the point, and where exactly that line sits needs the owner's judgement.

### 4.8 Should the platform warn at the point of posting

**A modal on every post is patronising and useless.** It tells a lawyer their own professional obligation as though they might not know it, it earns banner-blindness within a week, and it provides no protection whatsoever — legal, practical, or reputational. It is the design equivalent of a disclaimer.

**A specific, cited, one-time notice is genuinely useful,** because the thing lawyers do not know is not "be careful"; it is how strict the actual test is. Most practitioners are surprised that a hypothetical counts. So:

1. **On the first post only, dismissible forever:** a short notice naming ABA Formal Opinion 511R and stating the real test — could a reader infer the client or the situation, now or later. A citation is respected; a nag is resented.
2. **A permanent one-line statement near the composer** giving the venue's facts rather than restating ethics: who can read this, whether it is indexed, how long it lasts, and how fast it can be removed.
3. **A real removal path, because the honest protection is being able to undo.** A warning that a post is permanent is only honest if the post is permanent — and it should not be. Making removal fast and complete is worth more than every banner combined.

---

## 5. Where these live

### 5.1 The mapping to the owner's hierarchy

| Tier                 | What sits there                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Login**            | Unchanged                                                                                                                                                                        |
| **Main application** | **The feature board** — `/community` inside the app, behind the session, using the existing app shell                                                                            |
| **Other**            | **The public changelog** and the curated roadmap projection; the status page (shipped); marketing; documentation; the trust center. A forum, if it ever existed, would live here |

This is not a rhetorical alignment. Putting the board in the application rather than in "other" is what removes its public identity problem, its indexing problem, its anonymous-abuse problem, and its competitive-leakage problem, all at once.

### 5.2 Deployables

**The public changelog needs no compute at all.** It is a build-time artifact rendered to static pages: a Workers static-assets deployment with no `main`, no bindings, and nothing to invoke. That is more fate-isolated than the status worker, which at least reads a KV namespace, and it inherits the status page's own reasoning: every response is byte-identical for every reader, so the edge cache key fully determines the body.

**The feature board's read and write paths both live in `apps/worker`.** This deliberately breaks the symmetry with the status design, and the reason is worth stating so nobody "fixes" it later: status split its read into an isolated worker because a status page must survive the outage it is reporting, and because its responses are identical for everyone. Neither holds here. A board's read is per-reader (your own vote state differs), so it is not cacheable in that way; and a board being unavailable during an incident is fine — it is the status page's job to be up, not the board's. `apps/worker` already binds the control-plane database and already holds Better Auth, so the board reuses both. **Adding a database binding to the public read worker to serve the board would break the one invariant that worker has**, and buy nothing.

**The `@magna-carta/community` package boundary from the 2026-06-17 design is retained unchanged**, including its fitness function: no dependency on the firm-scoped data-access layer and no per-firm binding. The isolation is the confidentiality boundary, and it is what keeps a later repository split cheap.

**On Durable Objects and preview URLs.** A Worker implementing a Durable Object gets no Cloudflare preview URLs. That constraint is real and it costs nothing here, for two reasons. First, **it is already priced in repo-wide**: every one of the thirteen workers in `apps/` sets `preview_urls: false` today, so no workflow depends on them. Second, **nothing in this design needs a Durable Object.** Vote counting is a unique constraint on `(postId, userId)` plus a denormalized counter in the control-plane database; a Durable Object would add a migration lifecycle and a stateful deploy to a workload that has neither coordination nor contention. If a forum is ever built, live-thread coordination is the one thing that might argue for one — and by then it is a separate deployable where the question can be answered on its own terms.

### 5.3 The unresolved domain question

The owner states that `magna-carta.com` is marketing and `magnacarta.esq` is the product. The white paper's _Delivery model_ hosts table says `magnacarta.esq`/`www` carries marketing, the help center, intake, **and the public product-updates pages**. Those are not the same plan, and the changelog is exactly the page they disagree about.

**Recommendation: the public changelog goes on `magnacarta.esq`, alongside status.** The status page already shipped at `status.magnacarta.esq`, and status and changelog are the same trust surface — a reader checking whether something is broken and a reader checking what changed are usually the same person, mid-incident. Splitting them across two registrable domains halves the credibility of both and doubles the routing and certificate surface. The cost is that the changelog's search-engine value accrues to the product domain rather than the marketing domain, which is a small loss and arguably not a loss at all.

**This needs the owner to settle it**, and it should be settled before the first public page ships, because a published URL is a permanent one.

---

## 6. Spam, abuse and moderation as a standing operational cost

**The honest position: the platform does not moderate at 3am. It degrades, and a human deals with it at 9am.** Everything below exists so that the standing cost is minutes per week rather than hours per day, and so that the worst night is bounded.

1. **Writing requires a provisioned firm.** A spammer must complete email verification, Turnstile, and the self-serve registration flow before posting once. This is the single highest-value control in the list and it is already built.
2. **First-post pre-moderation.** A community profile's first post and first comment are held until approved; after one approval the account posts freely. Nothing from a brand-new account is ever publicly visible before a human has seen it. Cost: latency on genuine first posts, which is acceptable and can be stated in the interface.
3. **Turnstile plus per-account and per-firm rate limits** on every write path.
4. **A read-only kill switch in KV.** One operator write, no deploy, and every community write endpoint returns a stated refusal. **Built with the first write endpoint, not added later** — it is twenty lines at the start and a retrofit across every route afterwards. This is the concrete answer to the 3am question.
5. **Report-to-hide with a distinct-firm threshold.** N reports from N distinct firms hides a post pending review; requiring distinct firms bounds report abuse using the same `firmId` the ranking already needs.
6. **The owner moderates.** Stated plainly, because a design that assumes a community team is a design that fails. If the standing cost ever exceeds minutes per week, **the correct response is to narrow the surface, not to hire** — and the surface is narrowable, because the board is login-gated and gated on provisioning.

For a login-gated board with provisioned-firm writes and first-post pre-moderation, realistic load is a handful of items per week. For a public forum it is unbounded — which is, again, an argument about shape rather than staffing.

---

## 7. Expensive to retrofit — decide now, build later

Everything here is cheap today and either impossible or painful later. This is the section to disagree with now if at all.

| Decision                                                                            | Why now                                                                                | Cost of retrofit                                                                                        |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **`audience` on every changelog fragment, required, no default**                    | 87 fragments today, all mechanically `internal`                                        | A judgement call per file at 800 fragments; nobody will do it                                           |
| **`firmId` on every vote and post, captured at write time**                         | One column                                                                             | Unreconstructable. Firm membership changes, so it cannot be derived from the account later              |
| **`noindex` on all member-authored content, permanently, from the first byte**      | One header. The changelog and roadmap want indexing; member content must never have it | Impossible. Search engines and archives already have it, and there is no recall                         |
| **Notification emails link, never quote**                                           | A design rule with no code cost                                                        | Impossible. A quoted body sits in inboxes forever and no removal path reaches it                        |
| **No target-date field in the roadmap schema — absent, not nullable**               | The cheapest thing to build is the thing not built                                     | A nullable column gets populated, and then it is a promise                                              |
| **A post body has exactly one home** — no second full-text index, no analytics copy | A structural constraint, free at the start                                             | Removal becomes a distributed erasure across stores rather than one write                               |
| **Portal external principals excluded structurally, not by a permission check**     | The two surfaces already use different principal types on different hosts              | A refactor away from being wrong, and the failure discloses a firm-client relationship                  |
| **A read-only kill switch in KV, built with the first write endpoint**              | Twenty lines                                                                           | A pass across every route, done under pressure during the incident that needed it                       |
| **Community profile is a separate record; display name is never the account name**  | One table                                                                              | A rename that touches every read path, with a window where real names have already been shown           |
| **Public post numbers drawn from a real sequence**                                  | The sequence-numbering package already exists                                          | URLs are permanent; a row identifier leaks volume and cannot be changed once published                  |
| **Edit history is never public**                                                    | A rendering decision                                                                   | A lawyer editing an over-identifying post must not leave the original visible. Once rendered, it is out |
| **Login-gated board read**                                                          | Free at the start                                                                      | Closing a previously public board is a visible retreat, and the archive is already out                  |

---

## 8. Considered and rejected

- **A second, hand-written public changelog.** A second home for the same fact; drifts within a month. This is the whole reason the source question is asked up front.
- **Generating the public entry from the developer entry with a model.** Version-accuracy by construction is the property ADR-0048 was chosen for, and a generated sentence that overstates a shipped change is exactly the drift it prevents. The author writes both, in one file, in one commit.
- **Defaulting `audience` to `internal`.** Fails silently — the public changelog quietly stops being written and nobody notices. Requiring the key is the point.
- **Publishing `ROADMAP.md` verbatim.** Internal execution tracking, in slice and phase vocabulary, which outside this repository reads as a schedule.
- **A public, logged-out feature board.** Trades member content and competitive intelligence for acquisition value that `noindex` has already removed.
- **One firm, one ballot.** Disenfranchises the paralegal who feels the cost most. Ranking by distinct firms achieves the same anti-stuffing property without it.
- **Revenue-weighted or plan-weighted voting.** Defensible in B2B generally and recommended by the practice literature, but here it makes a bigger cheque buy more influence on a platform whose reason to exist is escaping per-seat cost-scaling. The seam is kept for free.
- **Real-name-and-firm forum identity.** Makes the forum useless for the questions that motivate it, and sits closest to the Formal Opinion 511R hazard.
- **Anonymous (unauthenticated) posting.** Unbounded account supply, no accountability, and content that is worth nothing because it comes from nobody.
- **Per-post identity choice.** Makes non-disclosure a signal.
- **A confidentiality modal on every post.** Patronising, blind within a week, and legally worthless. Replaced by one cited notice, one permanent factual line, and a real removal path.
- **Discourse (or any self-hosted forum).** An off-Cloudflare persistent host with Postgres and Redis, plus a permanent patch obligation — the same operating-model reasoning that rejected Fider and kept the self-hosted messaging gateway as a documented fallback only. Not a licence objection.
- **GitHub Discussions as the forum.** Requires a GitHub account, which is a real barrier for this audience; fully public and indexed; and it puts customer content in a third party with no removal guarantee we can honour.
- **Hosted feedback tools (Canny, UserJot, Featurebase).** Already rejected in ADR-0044 for per-tracked-user cost-scaling and the boundary mismatch. One new reason: they would hold member content outside our removal path, which section 7 makes non-negotiable.
- **A Durable Object for vote counts or board state.** A unique constraint plus a counter is sufficient; a Durable Object adds a migration lifecycle and a stateful deploy for no gain.
- **An isolated public read worker for the board** (mirroring the status worker). Its responses are per-reader and its availability is not load-bearing during an incident; the binding it would need is the one the status worker's invariant forbids.

---

## 9. Open questions for the owner

1. **Which domain carries the public changelog** — `magna-carta.com` or `magnacarta.esq` (section 5.3). Recommended: `magnacarta.esq`, beside status. Needs settling before the first public URL exists.
2. **The firm-count threshold at which the feature board opens.** Recommended: build it when there is a second cohort of firms, not before; a vote count at one tenant is noise.
3. **The verified badge's granularity** (section 4.7) — how much professional detail a badge may carry before it reconstructs the identity the pseudonym exists to hide.
4. **Whether the curated public roadmap projection ships with the changelog or waits for the board.** It can be hand-written in the artifact from the start, which argues for shipping it early.
5. **Whether declined requests should ever be re-openable by vote.** Recommended: no automatic mechanism — re-opening is an operator act, or the "needs more firms wanting it" decline reason handles it explicitly.

---

## 10. Decision summary

1. **Public changelog first, alone.** It renders from `changelog.d/` — the same source, filtered and re-voiced, never a second source.
2. **`audience` becomes a required fragment key with no default**, and a `public` fragment carries its user-facing prose in a `## Public` block in the same file. A new fitness function enforces both; all 87 existing fragments migrate to `internal` in one pass.
3. **The changelog publishes dated entries, not versions**, until releases begin being cut; the artifact carries both fields.
4. **Feature voting is an in-app, login-gated surface**, not a public website — which removes its indexing, identity, anonymous-abuse, and competitive-leakage problems together. The public gets a curated roadmap projection instead.
5. **Community identity reuses Better Auth**; firm staff participate, **portal external principals are excluded structurally**, prospects read only. **Requiring a provisioned firm to write is the anti-astroturf control.**
6. **`firmId` on every vote; ranking by distinct firms**, displayed with a floor of five. Revenue weighting rejected, seam kept.
7. **Declining is mandatory, reasoned, public and permanent**, with a thirty-day triage clock and twelve-month auto-archive.
8. **No target-date field exists in the roadmap schema.** Three columns, no dates, a standing statement that cards move backwards.
9. **Do not build the forum.** Build the knowledge base and the private support channel; the confidentiality-safe venue already exists and is called support. Keep the `discussion` seam dormant and re-take the decision against three named conditions.
10. **If a forum is ever built: verified-pseudonymous, no firm displayed, `noindex`, login-gated read, first-post pre-moderation, its own deployable.** One cited first-post notice, not a modal on every post.
11. **The platform degrades rather than moderating at 3am** — a read-only kill switch in KV, built with the first write endpoint.
12. **The changelog is static assets with no bindings; the board lives in `apps/worker`; no Durable Object anywhere.** The preview-URL constraint is already priced in repo-wide.

---

## Sources

- [ABA Issues Formal Ethics Opinion 511 on Confidentiality Obligations of Lawyers Posting to Listservs](https://www.fwlaw.com/insights/aba-issues-formal-ethics-opinion-511-on-confidentiality-obligations-of-lawyers-posting-to-listservs)
- [Understanding ABA Formal Opinion 511: Confidentiality Obligations When Using Listservs — Alameda County Bar Association](https://www.acbanet.org/2024/05/23/understanding-aba-formal-opinion-511-confidentiality-obligations-when-using-listservs/)
- [ABA issues ethics guidance on a lawyer's use of listservs, particularly for pending matters — The Florida Bar](https://www.floridabar.org/the-florida-bar-news/aba-issues-ethics-guidance-on-a-lawyers-use-of-listservs-particularly-for-pending-matters/)
- [Feature voting best practices — Canny](https://canny.io/blog/feature-voting-best-practices/)
- [Feature Voting Best Practices for Product Teams — ProductLift](https://www.productlift.dev/blog/feature-voting-best-practices)
- [Public Roadmap Best Practices for SaaS Companies — Heedback](https://www.heedback.io/en/blog/public-roadmap-best-practices)
- [Should I Publicly Share a SaaS Startup's Product Roadmap? — SaaS PM](https://www.saaspm.com/p/should-i-publicly-share-a-saas-startups)
- [Member Forums: Don't Build a Ghost Town — i4a](https://www.i4a.com/blog/online-member-forums-best-practices/)
- [Forum Spam: How to Permanently Stop Spam Bot Registrations — Akismet](https://akismet.com/blog/forum-spam/)
- [The Law Community — Clio](https://community.clio.com/)
- [Lawyer Forums: Best Online Communities for Lawyers — Clio](https://www.clio.com/blog/lawyer-forums/)
- [Vercel Changelog](https://vercel.com/changelog) · [Linear Changelog](https://linear.app/changelog) · [Stripe Changelog Review](https://buildtogether.substack.com/p/stripe-changelog-review)
