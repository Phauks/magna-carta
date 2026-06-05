# Documentation writing standard (the shared "language")

**Status:** Active — applies now.

**Scope (single home for):** the standard _language_ for everything we write about changes — commit messages, changelog entries, PR descriptions, bug-fix and feature writeups, and the canonical domain vocabulary. Sibling: [`documentation.md`](documentation.md) covers _what_ to document and _when_ (definition of done); this file covers _how to word it_, so the same change reads the same way everywhere.

**Principle:** clear, concise, consistent. Prefer plain words and cut needless ones; describe the effect, not the mechanism, for anything a user reads.

## One vocabulary of change types

We use **Conventional Commits** types, mapped to **Keep a Changelog** categories. Use these names everywhere — commits, PRs, changelog.

| Commit type                                        | Changelog category | Means                           | In changelog?        |
| -------------------------------------------------- | ------------------ | ------------------------------- | -------------------- |
| `feat`                                             | Added              | a new capability                | yes                  |
| `fix`                                              | Fixed              | a bug fix                       | yes, if user-visible |
| `change` (or `feat!`)                              | Changed            | changed existing behavior       | yes                  |
| `deprecate`                                        | Deprecated         | still works, slated for removal | yes                  |
| `remove` (or `feat!`)                              | Removed            | a capability removed            | yes                  |
| `security`                                         | Security           | a vulnerability addressed       | yes                  |
| `perf`                                             | Changed            | performance improvement         | if user-visible      |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore` | —                  | internal only                   | no                   |

A trailing `!` or a `BREAKING CHANGE:` footer marks a breaking change.

## Commit messages — `type(scope): summary`

- **Imperative, present tense:** "add trust reconciliation export," not "added" or "adds."
- Summary ≤ ~72 chars, lowercase, no trailing period. `scope` is the area (`trust`, `directory`, `portal`, `docs`, …).
- Body (optional): the **why** and the high-level what. Footers: `Refs ADR-00NN`, issue links, breaking-change note, and the `Co-Authored-By` trailer.

```
fix(trust): prevent negative client ledger on same-day reversal

A reversal posted before the original cleared could drive a client
ledger negative, violating the no-negative invariant. Order entries
by post time and re-check the invariant before commit.

Refs ADR-0008
```

## Changelog entries

- One line per change, under the right category, in [`CHANGELOG.md`](../../CHANGELOG.md) `[Unreleased]`.
- **User-facing language, imperative present:** "Add LEDES e-billing export." "Fix timer losing state across devices."
- Describe the **effect for the user**, not the implementation — no file names, no internal types. Link the PR/issue when useful.

## Bug-fix writeup (PR / commit body)

State briefly, in order: **Symptom** (observable failure) · **Root cause** · **Fix** · **Impact** (who/what was affected; any data-integrity consequence). For anything touching money, trust, conflicts, or security, name the invariant involved and how it is now protected.

## Feature writeup (PR / spec link)

**What** (one-line user-facing summary) · **Why** (the need) · **How to use** (link the guide in [`../user/`](../user/)) · **Decisions** (link ADRs) · **Follow-ups** (deferred seams). Design detail lives in the spec — link it, don't restate it.

## Voice & tense

- **Developer docs:** terse, technical, present tense, active voice.
- **User docs:** plain language, second person ("you"), task-oriented steps, **no jargon or architecture**. Introduce a term only when unavoidable.

## Line wrapping — never hand-wrap

Author prose **unwrapped**: one line per paragraph (a line break ends the paragraph). Do not insert manual breaks to hit a column width — every paragraph in the white paper, ADRs, and specs is a single long line, soft-wrapped by the editor. Hand-wrapping produces noisy diffs (editing one word reflows the wrap points across the whole paragraph), whereas an unwrapped paragraph changes exactly one line. A **semantic line break** (one sentence per line) is fine where a long paragraph benefits from sentence-level diffs — a deliberate authoring choice, not column-wrapping. The formatter enforces it: Oxfmt runs with `proseWrap: "preserve"`, so it never reflows prose. Code wrapping is the formatter's job (`printWidth: 100`), never manual — see [`code-style.md`](code-style.md).

## Canonical terminology

Use the left term, avoid the right, in **all** docs — this is the shared glossary. Extend it as domain terms settle.

| Use                               | Avoid                         | Note                                              |
| --------------------------------- | ----------------------------- | ------------------------------------------------- |
| matter                            | case, file                    | the top-level unit of work and access             |
| Directory                         | contacts, address book, cards | the people/organizations SSOT                     |
| firm                              | tenant, account, org          | "tenant"/"organization" only in architecture docs |
| Location                          | office, branch                | the first-class office entity                     |
| timekeeper                        | (user) when billing           | who records time                                  |
| time entry                        | timeslip                      | a unit of recorded time                           |
| trust account / operating account | escrow, "the IOLTA" (loosely) | be precise; IOLTA is one kind of trust account    |
| client portal                     | extranet, sharing site        |                                                   |
| share / grant                     | permission (loosely)          | a `PortalGrant`                                   |
| conflicts check                   | conflict search               |                                                   |
| safe custody                      | document storage              | the register of physical originals                |

> Cross-reference rule (recap from [`documentation.md`](documentation.md)): reference the white paper by **document + topic name** or a stable **`ADR-NNNN`**, never a `§` number.
