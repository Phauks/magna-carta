---
number: 279
slug: public-changelog-audience-and-source
status: Proposed
date: 2026-08-11
area: Product updates / Changelog
summary: "The public changelog renders from `changelog.d/` — the same fragments that assemble `CHANGELOG.md` — rather than becoming a second thing to maintain, but only after the fragment contract gains a REQUIRED `audience:` key with NO DEFAULT in either direction and a `## Public` block carrying the user-facing prose of a public fragment. The filter is necessary and not cosmetic: of 87 fragments today roughly a quarter are design documents, at least fourteen say in their own words that they ship no product code, and one is a competitor build-platform evaluation — publishing those would advertise features that do not exist, which breaks version-accuracy-by-construction in the opposite direction from the one ADR-0048 guarded. Both defaults are wrong (public publishes research notes the first time someone forgets; internal fails silently and the public changelog quietly dies), so the key is required and a new fitness function fails the build without it. The 87 existing fragments migrate to `internal` in one mechanical pass now, which is an hour today and a judgement call per file at 800. Entries publish DATED, not versioned, because no releases have been cut."
---

**The public changelog renders from the existing fragments, gated by a required `audience` key and a
public prose block in the same file.**

**Context:** This repository already assembles `CHANGELOG.md` from per-entry fragments in
`changelog.d/` via `vp run changelog-build`, and those fragments are already written to the
documentation-writing standard — user-facing language, effect not mechanism, imperative present. A
public changelog should therefore render from that source rather than becoming a second home for the
same fact, which is the golden rule and also simply what would happen: a hand-maintained public
changelog drifts within a month. The question is whether it holds unchanged. It does not.

**What fails today.** The corpus is 87 fragments (55 Added, 10 Changed, 13 Fixed, 1 Security).
Roughly a quarter are design documents; at least fourteen state in their own words that they ship no
product code; several are research. One entry is a per-job evaluation of whether the quality gate
should move from GitHub Actions to Cloudflare Workers Builds, ending "Research only — no decision, no
configuration changed." That is a correct entry for this repository and an actively harmful one for a
customer: it advertises a build-platform evaluation, describes work no user can touch, and reads as a
product changelog saying the team spends its time on continuous integration. The design-only entries
are worse — a public changelog describing billing before billing exists breaks
**version-accuracy-by-construction**, the exact property ADR-0048 chose the bundled-artifact model to
guarantee, in the opposite direction from the drift it guarded against.

**Decision:**

1. **`audience:` becomes a required fragment frontmatter key** — `public` or `internal` — **with no
   default in either direction.** Both defaults are wrong, and asymmetrically so: defaulting to
   `public` publishes a research note the first time someone forgets, and defaulting to `internal`
   means the public changelog quietly stops being written and nobody notices, which is worse because
   it fails silently. This tree already holds the equivalent line — the status page never invents a
   green, and absence of evidence is not evidence of health. A fragment that has not decided its
   audience fails the build.

2. **A `public` fragment carries its user-facing prose in a `## Public` block in the same file.** The
   developer entry stays where it is; the customer entry goes below the marker, one file, one commit,
   one review. This is not the duplication the golden rules prohibit — the root `CLAUDE.md` already
   draws exactly this boundary between developer docs and user docs: different facts for different
   readers, no shared sentences to drift. A fragment marked `public` with no public block fails the
   build.

3. **A new fitness function, `pnpm run lint:changelog-fragments`,** modelled on `lint:decisions` —
   same shape, same posture: refuse in the author's own pull request where the fix is one edit,
   rather than in assembled output on `main`.

4. **The rule of thumb is stated once and is readable in a diff:** a fragment describing something a
   user can now do is `public`; a fragment describing a design, a decision, a research finding or an
   internal tool is `internal`. **Design-only work is `internal` by definition** — it has not shipped.
   The author proposes at write time and the owner confirms at merge.

5. **All 87 existing fragments migrate to `audience: internal` in one mechanical pass, now.** This is
   the clearest reason to take the decision before the surface is built: an hour today, a judgement
   call per file at 800 fragments, and at that size nobody does it.

6. **Entries publish dated, not versioned.** `CHANGELOG.md` has a single `[Unreleased]` section and no
   versioned sections at all, so a version list would have to be invented. The artifact schema carries
   both a date and an optional version; the renderer switches from grouping by date to grouping by
   version when releases begin being cut, with nothing reshaped. Vercel and Stripe both run dated,
   filterable, entry-level changelogs, which is the shape that reads best for a continuously deployed
   product regardless.

7. **One artifact, two renderers, one source.** The same generated artifact feeds the public page and
   the in-app updates route of ADR-0048, which reads it from the bundle.

**Considered & rejected:** **A second, hand-written public changelog** (a second home for the same
fact; drifts within a month — the thing this decision exists to prevent); **generating the public
sentence from the developer entry with a model** (a generated sentence that overstates a shipped
change is precisely the drift version-accuracy-by-construction prevents, and it would be produced by
the automation rather than caught by review — the author writes both); **defaulting `audience` to
`internal`** (fails silently, which is the failure mode that does not get noticed); **defaulting to
`public` with an opt-out** (publishes a research note the first time someone forgets, and the first
time is unrecoverable); **filtering at render time by heuristics on the entry text** (a filter that
guesses is a filter that will one day guess wrong on the one entry that matters); **a separate
`changelog-public.d/` directory** (two directories to keep in step is the same drift with extra
steps); **publishing only `Fixed` and `Security` entries** (mechanical, and it would suppress exactly
the new capabilities a changelog exists to announce). Extends **ADR-0048** (product updates — the
bundled artifact and version-accuracy-by-construction are unchanged; this supplies the audience filter
its public read surface always needed) and **ADR-0037** (living docs). Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../specs/2026-08-11-community-surfaces-design.md).
