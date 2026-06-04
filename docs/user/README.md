# User-facing documentation

End-user and administrator documentation — the docs **people who use the product** read, distinct from the developer docs elsewhere in `docs/`. This is the authoring home; the strategy and channels are designed in the white paper's _User-facing documentation_ area (don't restate it here).

**Audiences:**

- **End users** (lawyers, paralegals, staff) — how to use each feature. One guide per feature in [`features/`](features/).
- **Administrators** (firm owner) — setup, configuration, users & roles, locations, trust/billing administration, integrations. In [`admin/`](admin/).
- **Portal users** (clients, co-counsel, experts) — how to use the client portal. Lives under `features/` until it grows into its own section.

**Channels these publish to** (white paper, _User-facing documentation_): a public help center (SEO-friendly Workers static assets), in-app contextual help, and admin docs.

**Per-feature guide pattern** — each file: what it does (plain language) · how to do the common tasks (step by step) · tips & edge cases · related features. **No internal architecture** — link to the feature, never the code.

**Rule:** a user-visible feature is not done until its guide here and its in-app help exist or are updated — see _Documentation is part of "done"_ in [`../conventions/documentation.md`](../conventions/documentation.md).

## Status

Scaffolding — guides are authored as features ship.
