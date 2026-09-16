# Changelog fragments

Add one file per notable change here instead of editing `../CHANGELOG.md`. Filename: a short
kebab-case slug. After merge to `main`, `vp run changelog-build` folds fragments into the assembled
changelogs and removes them.

## The frontmatter

Two keys, both required:

- **`category:`** — Added · Changed · Deprecated · Removed · Fixed · Security.
- **`audience:`** — `public` or `internal`. **There is no default in either direction.**

`audience` decides which of two assembled documents the fragment feeds:

| audience   | Folds into                                                                             | For                             |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------- |
| `internal` | [`../CHANGELOG.md`](../CHANGELOG.md) only                                              | The people building Magna Carta |
| `public`   | `../CHANGELOG.md` **and** [`../docs/public-changelog.md`](../docs/public-changelog.md) | The people using it             |

**The rule of thumb:** a fragment describing **something a user can now do** is `public`. A design, a
decision, a research finding, or a tool only this repository uses is `internal` — and design-only
work is `internal` by definition, because it has not shipped.

Neither default would be safe, and they fail differently. Assuming `public` publishes an internal
research note the first time somebody forgets, and that cannot be unpublished. Assuming `internal`
means the public changelog quietly stops being written and nobody notices, which is worse because
nothing announces it. So a fragment that has not decided fails the gate.

## When a change genuinely has no entry

`pnpm run lint:changelog-coverage` asks for a fragment whenever a change touches first-party source,
which is the floor golden rule 5 always implied and nothing held. When a change truly warrants no
entry, say so in the change itself: `changelog.d/exemptions/<slug>.md`, carrying one `reason:` key in
words.

Three properties make that the right shape. It is **in the diff**, so a reviewer reads the claim
beside the change it excuses — a flag in a workflow file is invisible exactly when it matters and
excuses every change after it. The reason is **written out**, which is the whole of the review this
gate forces: not the entry, the decision about whether there is one. And it counts only as part of
**this** change, so one left behind grants nothing to anybody else.

The directory is one level down on purpose: the assembler reads `.md` files directly inside
`changelog.d/`, so an exemption can never be folded into the changelog as though it were an entry.

## An internal fragment

```markdown
---
category: Changed
audience: internal
---

**What changed, in the repository's own language.** Mechanism is welcome here.
```

## A public fragment

The customer-facing sentences go in a `## Public` block below the developer entry — one file, one
commit, one review, and no shared sentences between the two to drift apart.

```markdown
---
category: Added
audience: public
---

**The developer entry.** Mechanism, file names, the seam it leaves behind.

## Public

**What you can now do.** Effect rather than mechanism, in the reader's language, with no internal
vocabulary and no repository paths.
```

A `public` fragment with no `## Public` block fails the gate, and so does an `internal` fragment that
carries one — nothing would ever read it.

## Checking a fragment

```
pnpm run lint:changelog-fragments
```

It checks the frontmatter fence, the two keys, the public block, kebab-case filenames, and the
absence of emojis (golden rule 2 — a changelog is where that ban gets tested, because bulleted
highlights with emoji prefixes are the house style of every hosted changelog product). The same
validation runs over the whole set inside `vp run changelog-build` before it folds anything: folding
deletes the fragment, so a bad one has to be a clean no-op rather than a half-consumed assembly.

Language and phrasing: [`../docs/conventions/documentation-style.md`](../docs/conventions/documentation-style.md).
Workflow: [`../docs/conventions/documentation.md`](../docs/conventions/documentation.md).
