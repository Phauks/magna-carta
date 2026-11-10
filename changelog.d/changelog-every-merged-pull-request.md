---
category: Changed
audience: public
---

**The Changelog lists every merged pull request.** `/updates` now reads `docs/pull-request-ledger.json`, which `tooling/doc-fragments/build-pull-request-ledger.mjs` rebuilds from first-parent history: one row per squash-merged pull request with its number, commit, landing day, the application areas its paths fall in (four or more read as "Across the app", none as "Behind the scenes"), and the developer text of the fragment it added. The assemble-docs workflow rebuilds it whenever a merge carries a fragment, and the docs-sync routine runs it as a backstop. The screen (`pull-request-changelog.svelte`) groups rows by day and folds each day and each pull request on a leading caret (`Accordion.Trigger` gains `chevron="start"`), puts each pull request on a card with linked pull-request and commit badges, and filters by kind, area and whether members see the change from three compact menus.

## Public

**The Changelog now shows every change, with where it landed in the app.** Each change is tagged with the parts of Magna Carta it touched, so you can filter to Matters, Billing or any other area and see when it last changed. Filter by kind of change or to only what members see, search the notes, and fold entries away to read titles only.
