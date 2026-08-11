# UI development workflow — what to use to keep building the sign-in screen and get it into the product

**Date:** 2026-08-11
**Scope:** What software and what loop the firm should use for UI work on this stack — component workbench, design tool, preview and review, visual regression, accessibility automation — and specifically how the sign-in screen gets from a 27-version standalone HTML artifact into `apps/web`.
**Prompted by:** the owner's question — he wants to keep developing the sign-in UI, and he wants it in the real product.
**Purpose:** This is **research, not a spec and not a decision.** Nothing here is built or committed; no dependency is added and no config is touched. The binding decisions in this area are ADR-0053 (the owner design-review gate) and ADR-0076 (the design system), and nothing here changes either. One item is put forward as a real decision and carries a pending fragment: `docs/decisions/pending/ui-iteration-in-the-app-not-a-mockup.md`.

---

## 1. The recommendation

**Stop iterating the sign-in screen in the artifact and move the next round into the app.** Every element in the v27 annotation set names a component that already exists in `@magna-carta/design-system` and is already composed by `apps/web/src/routes/login/+page.svelte`. Once that is true, the artifact is no longer a design surface; it is a hand-maintained second copy of a screen that already ships, and each further round costs one full re-implementation.

**The real screen already iterates as fast as the artifact — the tooling gap is not speed, it is reach.** `vp dev` gives Vite HMR on `/login` with no Worker and no session, because the login route lives outside the `(app)` route group and its sign-in call already tolerates a missing backend. What the artifact provided that the app does not is (a) every state visible at once without clicking through them, and (b) a URL the owner can open on his phone. Those are the only two things worth building.

**So: three additions, in this order, and nothing else.**

1. **A screen-states developer page** for the sign-in flow — every step, every error, every theme and mode on one scrollable page — built on the developer-console machinery that already exists in `apps/web/src/lib/developer/`. Zero new dependencies. This is what replaces the artifact.
2. **An assets-only preview Worker** so the owner reviews from his phone at a stable per-branch URL, for zero CI minutes and zero request cost.
3. **Axe over the real login route** in the Playwright end-to-end harness that already exists at `apps/web/e2e/`.

**And three things not to do.** Do not add a component workbench — Storybook 10 with the Svelte CSF addon, browser-mode story tests and axe-at-error-level is already installed, current, and working. Do not introduce a design tool. Do not buy a visual-regression service; land the baselines the existing container harness is waiting for instead.

**The trigger condition, stated so it can be applied to the next screen without re-litigating this one:** iterate in a throwaway artifact only while **both** hold — the round explores a shape that has no component behind it yet, **and** the question is "which of these three" rather than "adjust this one". The moment every element of a round resolves to an exported component, the artifact has become a transcription of the app, and the next round belongs in the app. A complete set of `data-mc` annotations is precisely the assertion that this moment has arrived; it is a handoff signal, not a fidelity guarantee.

---

## 2. What is already right, and should not be changed

It is worth being explicit about this, because most of the honest answer to "what software should we be using" is "the software you already chose."

**The component workbench is current and correct.** The repository runs Storybook 10.4.3 (`pnpm-workspace.yaml` catalog) with `@storybook/svelte-vite`, `@storybook/addon-svelte-csf` 5.1.2, `@storybook/addon-a11y`, `@storybook/addon-docs` and `@storybook/addon-vitest`. Every one of those is a live, maintained package on the current line: Storybook's latest is 10.5.7 (published 2026-08-06), and `@storybook/addon-svelte-csf` 5.1.2 (2026-03-27) declares `svelte: "^5.0.0"` and `storybook: "… || ^10.4.0-0"` as peers. Storybook 10 itself declares `vite-plus: "^0.1.15 || ^0.2.0"` as a peer dependency — Vite+ is a supported builder upstream, not a workaround, which confirms the empirical note already in `packages/design-system/.storybook/main.ts`. There is no better option to migrate to and no reason to look for one.

**The story-as-test integration is the good version of this.** `packages/design-system/vitest.storybook.config.ts` runs every story as a browser-mode Vitest test in headless Chromium through Playwright, with `a11y.test = "error"` making axe violations fail. That is one artefact serving three purposes — review surface, behaviour test, accessibility gate — which is exactly what a component workbench is for and what most teams never get around to wiring.

**The visual-regression discipline is unusually well reasoned.** `packages/design-system/visual-regression/README.md` gets the hard part right: baselines are authoritative only from the pinned Playwright container, because font rasterization differs across operating systems, and the harness skips explicitly rather than passing silently when baselines are absent. The problem there is not the design. It is that the baselines do not exist yet.

**And the artifact workflow was right for the 27 rounds it ran.** During that period the design system's components were being invented and the screen's anatomy was genuinely unsettled; a self-contained file built from the real tokens, with a headless-Chromium assertion harness, is a good way to run that. The conclusion below is not that the method was wrong. It is that the method's precondition has expired for this screen.

---

## 3. The reasoning

### 3.1 The economics of mockup versus app, made concrete

A mockup round is cheaper than an app round only when the mockup can answer a question the app cannot answer yet. There are exactly two such questions: _what should this look like when the pieces do not exist_, and _which of several shapes do we want_. Everything else — spacing, wording, prominence, order, state coverage — the app answers directly, and answers authoritatively rather than by promise.

For the sign-in screen, both questions are closed. The screen at `apps/web/src/routes/login/+page.svelte` composes `Badge`, `Button`, `Checkbox`, `Input`, `Label`, `PasswordInput`, `VerificationCodeInput`, `Alert`, `Card` and `Masthead` — all exported from `@magna-carta/design-system`, all with stories, all under the axe gate. There is no element of the sign-in anatomy left that has no component behind it.

The cost being paid right now is not hypothetical. There are two sign-in screens in existence — the artifact and the shipped route — and only one of them is the product. Whichever is currently ahead, every further artifact round widens the gap and adds one more transposition to do later. A feedback batch applied to the artifact produces a diff nobody can merge; the same batch applied to `+page.svelte` produces a diff that ships.

**The one thing the artifact does that the app does not, and how to get it back.** The artifact shows the whole screen at once. The real screen is a three-step state machine held in component state (`step`, plus `credentialsRejected` / `verificationCodeRejected` / `pending`), so seeing the password step's error state means typing an email, submitting, submitting again with a wrong password, and doing it once per theme and mode. That is the entire reason the artifact still feels faster, and it is a fifty-line developer page away from being fixed. Render the three steps side by side, each with its error and pending variants, on one route, under the developer console's existing theme and mode switcher (`apps/web/src/lib/developer/modules/appearance/`), registered through the developer-page registry that `dev-page.ts` and `dev-page-links.svelte` already define. That is not new machinery; it is one more module in a console that already has six.

### 3.2 The review loop — and the Durable Objects wall

The owner reviews from a phone, so the question is: what URL does he open?

**The obvious answer is blocked, and it is worth knowing why.** Cloudflare Workers preview URLs are generated on `wrangler versions upload` and follow `<version-prefix-or-alias>-<worker-name>.<subdomain>.workers.dev`; `wrangler versions upload` explicitly does not deploy to production and takes a `--preview-alias` flag, so a branch can hold a stable named URL. But the documented limitation is decisive here: _"Preview URLs are not generated for Workers that implement a Durable Object."_ Cloudflare calls this temporary and says it is working to remove it, but as of now it holds. `apps/worker/wrangler.jsonc` binds ten Durable Object classes. The main Worker cannot have preview URLs, which is presumably part of why `preview_urls` is already set to `false` there.

**The way through is a second Worker that serves the built SPA and nothing else.** No Durable Objects, no D1, no R2, no Queues, no secrets — an `assets` directory binding and that is all. It is exempt from the limitation, and the economics are as good as they get: Cloudflare's billing documentation states that _"Requests to static assets are free and unlimited"_ and that there is no cost for storing assets. With no `run_worker_first` patterns and no Worker script to invoke, every request to it is free.

**It costs no CI minutes either, which matters given the austerity window.** `wrangler versions upload --preview-alias <branch>` runs from the agent's machine after a local `vp build` of `apps/web` — seconds, not a pipeline. This deliberately avoids turning on Workers Builds for non-production branches, which the repository's own [Cloudflare CI evaluation](2026-08-05-cloudflare-ci-evaluation.md) already established would build on _every_ push to _every_ branch, against a 20-minute cap and six account-wide concurrent slots already shared with seven real deploy connections.

**The honest limitation.** An assets-only preview Worker has no API, so sign-in cannot actually complete there. That is acceptable precisely because of the developer page in 3.1: every visual state is reachable without a backend. It is not acceptable as a general staging environment, and this recommendation is not one — a real staging environment with a live API is a separate, larger piece of work that ADR-0075 already defers.

**A second, free thing to put on the same Worker: the built catalog.** `storybook build` produces a static directory. Publishing it alongside the preview gives the owner the whole component catalog on his phone, across every theme and mode, at no marginal cost. That directly serves the ADR-0053 review gate, which currently requires the owner to be at a machine with the repository checked out and Storybook running.

### 3.3 Visual regression, honestly, at a zero-CI budget

The right answer is: **finish the harness you have before adding anything.**

The catalog harness is built and correct and produces nothing today, because it skips when baselines are absent and no container-authoritative baselines have ever been committed. Everything else in this section is worth less than closing that gap, and closing it requires one Docker run of `packages/design-system/visual-regression/update-baselines.sh` on a machine with Docker, plus a review of the resulting images. Until that happens, the repository has visual-regression _infrastructure_ and no visual-regression _coverage_, and adding more surface to an inert harness is not progress.

**Do not extend the catalog harness to app screens.** It runs over `storybook-static` and belongs to `packages/design-system`; pointing it at `apps/web` would invert the dependency the design system exists to protect. If the sign-in states eventually need pixel coverage, the place for it is `toHaveScreenshot` in the existing `apps/web/e2e/playwright.config.ts` against the developer states page, run inside the same pinned container under the same baseline discipline. That is a later step, not a now step.

**On buying it instead.** Argos is the named upgrade path in both the visual-regression README and `testing.md`, so it is worth sizing rather than hand-waving. The current matrix is 113 stories across 6 themes and 2 modes — 1,356 screenshots per run. Argos' free Hobby tier is 5,000 screenshots a month, which is three and a half runs; the Pro tier is $100 a month for 35,000 screenshots (about 25 runs), with overage at $0.0015 per Storybook screenshot. So the free tier does not cover a routine gate at this matrix size, and the paid tier is a real $1,200 a year. What $100 a month buys over the local container is baseline review in a web interface and per-pull-request status — genuinely useful when several people review, worth much less for a solo owner who can look at a diff image locally. The `@chromatic-com/storybook` addon is already installed and inert; Chromatic's current pricing was not verified for this document and should be before anyone reaches for it.

**Recommendation: neither, for now.** Land the container baselines, keep the harness local, and revisit a service when the constraint is "reviewing baseline diffs is slow" rather than "there are no baselines."

### 3.4 Accessibility — what automates, and what does not

**What is already automated is the larger half.** Every story runs axe with violations failing the test, which covers the component layer thoroughly: roles, names, contrast of token pairs, and label association. The token layer adds a WCAG 2.2 contrast gate over declared foreground and background pairs (`packages/design-tokens/src/contrast-pairs.ts`).

**What is missing is the route layer, and it is cheap to add.** Component-level axe cannot see the assembled document: landmark structure, a single `h1`, the page title, heading order, or the fact that `AuthFrame` wraps the card in a `main` with a decorative sibling. `@axe-core/playwright` 4.13.0 (against axe-core 4.13.0) drops into the existing end-to-end config as three assertions, one per step, in the spec that already drives a real login against a Miniflare-backed Worker. That is a handful of lines and no new infrastructure.

**What genuinely cannot be automated, and must stay owner or reviewer discipline.** Four things, all real for this flow:

- **Focus management across step transitions.** The `$effect` in `+page.svelte` moves focus into each step's field as `step` changes. No axe rule evaluates whether that is the _right_ place, whether it strands a screen-reader user mid-announcement, or what happens when focus moves while an assertive alert is being read. This needs the screen-reader pass the conventions already require.
- **Whether an error is announced at all, and in the right order.** `Alert` derives `role="alert"` from the danger variant, so the assistive technology contract is right on paper. Whether a real screen reader announces it when it is conditionally inserted, and whether that announcement collides with the focus move above, is an empirical question about a specific screen reader.
- **Whether the wording is understandable.** The deliberate refusal in `sign-in-messages.ts` to say which half of the credential was wrong is a security decision with a usability cost. Only a person can judge whether the resulting message leaves a user able to act.
- **Composited contrast.** The token contrast gate checks declared pairs. It does not check the card's text against the gold radial wash in `AuthFrame` compositing behind it, because that is a rendered result, not a declared pair.

### 3.5 The transposition path, concretely

The least-waste path from v27 to the app is **not** "re-implement the artifact." It is a three-bucket diff, because the shipped screen already exists and most of what v27 says is already true of it.

Walk the artifact against the running `/login` route and sort every difference into exactly one bucket:

- **A token difference** — a spacing step, a colour, a radius, a weight. Fix it in `packages/design-tokens/tokens/`, regenerate, re-pin the golden snapshot. It fixes every screen at once, and `+page.svelte` does not change.
- **A component difference** — a variant, a size, a state, a missing primitive. Fix it in `@magna-carta/design-system` with its story, which puts it under the axe gate and the visual-regression matrix. `+page.svelte` still does not change. One live example of this bucket: the screen currently carries a `QUIET_LINK` constant — a hand-assembled Tailwind utility string for the quiet inline-link register — repeated across anchors and buttons because there is no plain link component (there is `EyebrowLink`, which is a different register). Anything the artifact says about that register belongs in a new design-system component, not in the route.
- **A composition difference** — order, grouping, wording, which states exist. This is the only bucket that edits `+page.svelte`.

Sorting in that order is what prevents the classic failure of this transposition, which is patching a screen-local class string where a token or a component was the real answer, and then discovering the same drift on the next four screens. It is also the answer to "the artifact's fidelity is a promise rather than a fact": once each difference is routed to its real home, fidelity stops being a claim about a file and becomes a property of the system.

**Keep the `data-mc` convention.** It did real work: it is what makes the diff above mechanical rather than interpretive, and it is what tells you the artifact has reached its expiry. The next screen that legitimately starts as an artifact should use it again — and its completion should be read as the signal to stop, not as a deliverable.

---

## 4. Ranked — value against effort

| #   | Do this                                                                                      | Value                                                           | Effort                                                    | Cost                                               |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| 1   | Move sign-in iteration into the app; retire the artifact for this screen                     | Very high — removes a whole class of rework                     | None (a decision)                                         | None                                               |
| 2   | Sign-in screen-states developer page (all steps, errors, themes, modes on one route)         | Very high — restores the only thing the artifact did better     | Low, half a day, on existing developer-console machinery  | None                                               |
| 3   | Assets-only preview Worker, `--preview-alias` per branch, published from the agent's machine | High — the owner reviews from a phone with no CI spend          | Low, one small `wrangler.jsonc` and a script              | Free: static asset requests are free and unlimited |
| 4   | Publish the built Storybook catalog on the same Worker                                       | High for the ADR-0053 review gate                               | Very low once 3 exists                                    | Free                                               |
| 5   | `@axe-core/playwright` over the real login route, three steps                                | Medium-high — the route-layer gap component axe cannot see      | Very low, one dependency, a few lines in an existing spec | Free                                               |
| 6   | Land the first container-authoritative visual-regression baselines                           | Medium-high — turns built infrastructure into actual coverage   | Medium, needs Docker and a human review of 1,356 images   | Free                                               |
| 7   | Upgrade Storybook 10.4.3 → 10.5.7 opportunistically                                          | Low-medium — SvelteKit `$app/state` mocking and QR-code sharing | Low, a catalog bump                                       | Free                                               |
| 8   | Pixel coverage for the sign-in states via `toHaveScreenshot` in the app end-to-end harness   | Medium, but only after 6                                        | Medium                                                    | Free                                               |

---

## 5. What was rejected, and why

**Histoire — rejected, and it is not close.** `@histoire/plugin-svelte` is at `1.0.0-beta.1`, published 2026-01-07, and its declared peer range is `svelte: "^3.0.0 || ^4.0.0"`. It does not claim Svelte 5 support at all. The core `histoire` package pins `vite: "^7.3.0"` while this repository runs the Vite 8 distribution under the Vite+ name. This is not a maturity judgement about the project; it is simply not a candidate for this stack.

**A second Storybook in `apps/web` for screen-level stories — rejected for now, but it is a real option later.** `@storybook/sveltekit` 10.5.7 declares `svelte: "^5.0.0"` and Storybook 10 added SvelteKit `$app/state` mocking, which is exactly what the login page needs (it imports `page` from `$app/state` and `goto` from `$app/navigation`). Upstream still labels `$app/state`, `$app/navigation`, `$app/forms` and `$app/stores` support **experimental**. Set against that, it means a second Storybook build to maintain and run, when the developer console already provides the same review surface inside the running app at zero additional build cost — and the running app is a higher-fidelity surface than a stubbed one. Revisit when there are roughly ten or more screens wanting story-level state coverage; the calculus flips when the developer pages start duplicating each other.

**Figma — rejected.** Professional is $12 per editor per month billed annually ($15 monthly), with Dev Mode a $20 per editor per month add-on. The price is not the reason. The reason is that a design tool would create a **second source of design truth** for a system whose single source is already settled and machine-enforced: DTCG tokens under `packages/design-tokens/tokens/` compiled by Terrazzo into committed CSS custom properties, with purity, completeness, contrast and golden-snapshot gates behind them. Introducing Figma means either hand-maintaining a token mirror that will drift, or buying another tool to sync it. And the owner's feedback mode makes the tool redundant anyway: "back is too prominent" and "show me variants" are corrections to an existing artefact, and they apply to a Svelte component and a story faster than to a design file — with the additional property that the corrected version is the shipping one.

**Penpot — rejected on the same argument, not on price.** Self-hosting is free under MPL-2.0 with no per-user fees, and the hosted free tier covers eight members. It would still be a second source of design truth, and self-hosting is a service to run.

**Argos and Chromatic now — deferred, with the numbers in 3.3.** The free Argos tier does not cover this matrix, and there is nothing to review until baselines exist.

**Moving any of this into CI — rejected while austerity holds.** The repository's own Cloudflare CI evaluation of 2026-08-05 already answers this: Workers Builds cannot express the gate, builds every push on non-production branches, and competes for six account-wide concurrent slots with seven live deploy connections. Every recommendation above is deliberately runnable from a developer machine.

**A new image-diff dependency — rejected.** Playwright's built-in screenshot comparison already does the job, and adding a native binary would require a memory-safety argument under golden rule 14 that buys nothing.

**Replacing the artifact workflow wholesale — rejected.** The recommendation is scoped to _this screen at its current maturity_. A future surface with no components behind it should start as an artifact again, with `data-mc` annotations, and hand off the moment they all resolve.

---

## 6. The concrete first step

**One commit, in `apps/web`, adding one developer page.**

Register a `sign-in states` page in the developer-console page registry that renders the sign-in card in each of its states side by side — identify, password, password with a rejected credential, verification, verification with a rejected code, and each with its pending variant — by importing the same design-system components the route composes, under the console's existing theme and mode switcher. Then open `vp dev`, and run the next feedback batch against it.

That single page is the test of this whole document. If the next round of the owner's feedback lands as fast against it as it did against the artifact, the recommendation holds and steps 3 through 5 follow. If it does not, the reason will be specific and visible, and worth more than any further analysis.

---

## 7. Verified against live sources versus inferred

**Verified** (npm registry metadata and vendor documentation, 2026-08-11): Storybook 10.5.7 and its `vite-plus` peer range; `@storybook/addon-svelte-csf` 5.1.2 with a `svelte: ^5.0.0` peer; `@storybook/sveltekit` 10.5.7 with a `svelte: ^5.0.0` peer and its documented experimental `$app/*` support; `@histoire/plugin-svelte` 1.0.0-beta.1 with a Svelte 3/4 peer range; `@playwright/test` 1.62.1; axe-core and `@axe-core/playwright` 4.13.0; `vite-plus` 0.2.8; wrangler 4.120.1; the Workers preview-URL mechanism, its `--preview-alias` flag, and the Durable Objects limitation; Workers Static Assets billing ("free and unlimited"); Argos pricing tiers; Figma and Penpot pricing.

**Read from this repository** (not inferred): the design-system catalog configuration and its 53 story files carrying 113 stories; the six-theme, two-mode catalog matrix; the visual-regression harness and its "no baselines yet" state; the `preview_urls: false` setting and the ten Durable Object bindings in `apps/worker/wrangler.jsonc`; the developer-console module structure; the `apps/web/e2e` Playwright harness; the sign-in route's component composition and state machine.

**Inferred, and flagged as such:** the half-day estimate for the developer states page; the claim that the developer page will feel as fast as the artifact (this is the hypothesis the first step tests, not a finding); and the assessment that the artifact and the shipped route have diverged — the artifact is not in the repository, so its current contents were not read for this document.

**Not answered:** Chromatic's current pricing was not verified. Whether Docker is available on the owner's machine today — which decides how soon the visual-regression baselines can land — is not knowable from here. And the exact contents of artifact v27 were unavailable, so the three-bucket diff in 3.5 is a method rather than a completed inventory.
