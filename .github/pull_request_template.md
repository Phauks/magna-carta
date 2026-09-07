<!--
A merge to `main` deploys within minutes, with no second gesture. This description is the record of what was verified before that happened. Fill every section; where a lane does not apply, say so in a word rather than leaving it blank. The repository squash-merges, so the title becomes the commit subject on `main`: make it the sentence the history should carry.

Language: docs/conventions/documentation-style.md. Definition of done: docs/conventions/documentation.md.
-->

## What

<!-- One or two sentences, the effect for the reader. For a feature: What, Why, How to use (link the docs/user/ guide), Decisions (ADRs), Follow-ups. For a bug fix: Symptom, Root cause, Fix, Impact. Anything touching money, trust, conflicts or security names the invariant involved and how it is now protected. -->

## Why

<!-- The need, or the failure. Design detail lives in the spec; link it rather than restating it. -->

## Change type

<!-- Conventional Commits type: feat, fix, change, deprecate, remove, security, perf, refactor, docs, test, build, ci, chore. Add `!` for a breaking change. -->

## Reaches production as

<!-- Tick every row that applies, or the last one. Each of these lands on real firms at merge, so each says what verified it. -->

- [ ] Database migration (`packages/database`): chain intact, snapshot refreshed with `refresh-<lineage>-snapshot`, run against the load-profile fixtures
- [ ] API contract change: `emit-openapi` in `apps/api-worker` and `generate` in `packages/api-client` re-run, outputs committed
- [ ] Worker binding or `wrangler.jsonc` change: every named service exists before this merges
- [ ] New required secret: set in every environment before this merges, or the deploy fails on the missing name
- [ ] Design-token change (`packages/design-tokens`): generated CSS and Tailwind theme regenerated and committed
- [ ] None of the above

## Documentation, same commit

<!-- Every lane is either done or explicitly "does not apply". Silence is not "no docs needed". -->

- [ ] Developer docs: the relevant `docs/conventions/` standard, `docs/specs/` spec, or area `CLAUDE.md`
- [ ] White paper, only if the design changed
- [ ] Decision recorded: `docs/decisions/pending/<slug>.md` (never the Decision-Log register itself)
- [ ] User docs: `docs/user/` guide, in-app help, and admin docs where firm-owner behaviour changed
- [ ] Changelog fragment: `changelog.d/<slug>.md` with `category` and `audience` (never `CHANGELOG.md` itself)
- [ ] Feature ledger: `roadmap.d/` node status flipped, `vp run register-build` run, `docs/now.md` committed
- [ ] `ROADMAP.md` reflects the new status
- [ ] Slice status: `status.d/<slice>.md` edited, `vp run status-build` run, `STATUS.md` and `STATUS.json` committed
- [ ] Active-work note at `docs/active-work/<branch>.md` (retired with `vp run retire-note` once this lands)

## Verification

<!-- The test battery runs in CI only under the `run-tests` label, so the branch's own full `pnpm test` is the standing merge bar. State the actual result, including anything that failed or could not be run. Attach the label when one machine's run is not the evidence the change deserves: a migration, a contract change, a shard split. -->

- `pnpm check:scoped`:
- `pnpm test` (full, local):
- `run-tests` label: attached / not needed because

## Golden rules touched

<!-- Delete what does not apply. These are the ones a review most often catches late. -->

- [ ] UI styled only through Tailwind and `@magna-carta/design-system`; no raw CSS, no off-token values, no direct `bits-ui` import, Lucide icons, no emojis
- [ ] UI change built in `apps/web` or `packages/design-system`, checked against `docs/conventions/design-corrections.md`, and verified in the browser, not only in tests
- [ ] Business data read and written only through the firm-scoped data-access layer; bulk content to R2
- [ ] Errors reported through the standard pipeline, redacted by default, with a user-facing Error ID
- [ ] No process references in source (`ADR-NNNN`, spec sections, slice or phase numbers); reasoning stated inline
- [ ] Names written out in full; no shorthand
- [ ] No new C or C++ dependency, native or compiled to WASM, without explicit owner consent named here
