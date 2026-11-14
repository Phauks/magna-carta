# Legal citations — design

**Status:** Accepted (design) · **Date:** 2026-11-09 · **Owner:** Trevor Goldsmith
**Decides:** ADR-0501 (new)
**Builds on:** the Tools catalog (`packages/tools/CLAUDE.md`), the trust-jurisdiction profile
pattern (`packages/trust-jurisdictions`), the legal-research integration port (white paper,
_Integration platform_), the Magnus source card rulings (`docs/conventions/magnus-rulings.md`).

The owner asked on 2026-11-09 for "the Bluebook rules of citation" built into the application as a
general feature, "usable as a stand-alone tool, and within other components". Two follow-ups in the
same conversation shape it:

- **Link first, typing is the override.** "Fully writing out a case is a lot of work, and we need to
  do it in the manner best available. Manual should be a sort of override." A member pastes a link
  (or a rough citation) and the details are read beneath it; each field says where its value came
  from, and anything the member types wins over what was read.
- **States differ.** "We will need to be able to set citations to certain formats." A court or
  state has its own format, and a matter or document can be set to one.

Mockups the owner reviewed: `option-a-build.png`, `option-b-check.png`, `embedded-components.png`
and `citation-formats.png` in the project's shared `citations/` folder.

## 1. Which rules, and why not the Bluebook's text

_The Bluebook: A Uniform System of Citation_ is copyrighted, and "Bluebook" is a trademark the
Harvard Law Review Association has enforced: it threatened the public-domain "Baby Blue" project in
December 2015, which renamed itself _The Indigo Book_ on 2016-03-31
(<https://en.wikipedia.org/wiki/The_Indigo_Book>). _The Indigo Book_ implements the same Uniform
System of Citation and its current edition is dedicated to the public domain under CC0
(<https://law.resource.org/pub/us/code/blue/indigobook-2.1.html>, 2023 update of 2.0, published
2023-08-21).

So:

- The rules are implemented from _The Indigo Book_, and every rule the engine applies carries the
  Indigo Book rule or table number (`R11`, `T1.1`) so a member can check it.
- The application never reproduces Bluebook text and never names the Bluebook in its interface. The
  style is labelled **Uniform System (Indigo Book)**. Output that conforms to the uniform system is
  what courts that "require Bluebook form" receive; the name is the only thing left out.
- The California Style Manual is a second **base style**, because California state courts accept
  either it or the Bluebook form provided a filer is consistent
  (<https://en.wikipedia.org/wiki/California_Style_Manual>). Its rules are written from the manual's
  published examples, not copied.

## 2. Shape — one engine, three components, one tool

```
@magna-carta/citations  (pure: no Svelte, no network, no env)
  recognize   link or rough text  -> Recognized { kind, fields, provenance, lookup? }
  fields      merge(read, typed)  -> fields + per-field provenance (link | lookup | typed)
  format      (citation, format, form) -> FormattedCitation { runs, plainText, rules }
  formats     base styles + per-court formats + resolution (document > court > state > firm)
design-system components
  FormattedCitation   display + copy, italics as runs (never HTML strings)
  CitationField       paste a link, see the fields beneath, override any of them   (Build tab)
  CitationChecker     a whole document                                               (phase 2)
apps/web
  /legal-citations    the stand-alone tool: Build | Check a Document | Table of Authorities
```

The engine is pure so the same code runs in the browser, the Worker, Magnus's answer formatter and
document assembly. Every surface that shows a citation goes through `FormattedCitation`; nothing
hand-assembles "v." and italics.

**Embedding is the point, not an extra.** The Magnus source card (`SourceQuote`) takes its citation
line from `FormattedCitation`; the document editor recognizes a citation as it is typed; the matter's
authorities list is built from recognized citations. Those consumers land in their own slices; this
one ships the engine, the components and the tool they will call.

## 3. Reading a link — "the manner best available"

A recognizer is chosen by the pasted text. Three tiers, best first:

| Tier                 | Sources                                                                                                                                      | What the engine does                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Connected research   | Westlaw, Lexis links                                                                                                                         | Names the provider and document; the legal-research integration reads it. Unavailable until a firm connects one. |
| Public lookup        | CourtListener opinion links and any case citation                                                                                            | Returns a `lookup` request (provider + identifier); a Worker adapter fills case name, court and year.            |
| Self-describing link | govinfo link-service URLs (U.S. Code, CFR, Federal Register, public laws), Cornell LII, eCFR, Nevada Revised Statutes, California code pages | Reads every field from the URL itself. No network call.                                                          |
| Rough citation text  | "347 us 483", "42 usc 1983", "NRS 11.190"                                                                                                    | Parses volume, reporter, page / title, section. Case name and year come from lookup or the member.               |

Facts behind the table: CourtListener's citation-lookup API (`POST /api/rest/v4/citation-lookup/`)
needs an account token and, on the free tier, allows about 5 requests a minute and 125 a day, so a
busy firm needs a paid tier (<https://www.vaquill.ai/blog/courtlistener-citation-lookup-api-guide>);
govinfo's link service covers the U.S. Code, CFR, Federal Register and public and private laws, and
its API takes an api.data.gov key (<https://govinfo.gov/developers>); Westlaw and Lexis API access is
a procurement step separate from the subscription (white paper, _Integration platform_).

**Provenance per field.** Every field carries where its value came from: `link`, `lookup` or
`typed`. A typed value always wins and is kept when the link is re-read; clearing it restores the
read value ("Undo"). A field nothing could read is `missing` and the formatter says which required
fields are missing rather than guessing. Pin cites are almost always typed, because a link names the
whole opinion.

**Reporter data.** The engine ships a curated reporter table covering federal and the Pacific and
California reporters. Free Law Project's `reporters-db` (BSD, JSON, ~1,000 reporters,
<https://pypi.org/project/reporters-db/>) is the planned full table, imported at build time; its
recognizer patterns, and those of `eyecite` (BSD-2, <https://github.com/freelawproject/eyecite>),
are the reference. `citeproc-js` is not used: it is AGPL/CPAL (<https://github.com/Juris-M/citeproc-js>).

## 4. Formats per court and state

A **format** is a base style plus a list of differences, each citing the rule it comes from — the
trust-jurisdiction pattern. Shipped formats:

- **Uniform System** — no differences.
- **Nevada state courts** — uniform system plus Nevada's differences. The first is NRAP 36(c)(3): an
  unpublished disposition may be cited for persuasive value only if issued by the Supreme Court on or
  after 2016-01-01 or the Court of Appeals on or after 2024-08-15, and the citation must give an
  electronic database if available, the docket number and the date filed, with the notation
  "unpublished disposition" (<https://www.leg.state.nv.us/courtrules/NRAP.html>). Statutes are
  written `NRS 11.190`, the form Nevada's courts use.
- **California state courts** — the California Style Manual base style.

**Resolution:** the format set on a document wins, then the matter's court, then the matter's state,
then the firm default. A format that is not marked reviewed by an attorney is never selected
automatically (it can still be chosen by hand, labelled as unreviewed). Formats are data; the
firm-settings screen that edits them is a later slice.

## 5. Phasing

1. **This slice:** the engine (recognize, fields and provenance, format with full / short / _id._
   forms, formats and resolution), `FormattedCitation` and `CitationField` in the design system, and
   the `/legal-citations` tool with the Build tab. Case lookup is a seam: the engine emits the
   `lookup` request and the tool shows the fields as "you add" until the adapter lands.
2. Lookup adapters in the Worker: CourtListener (token as a firm secret), govinfo.
3. Check a Document and Table of Authorities (`CitationChecker`).
4. Consumers: Magnus source cards, the document editor, matter authorities, firm-settings formats.

## 6. What this does not do

It checks the **form** of a citation. Whether an authority is still good law is a citator's job,
reached through the legal-research integration (Westlaw KeyCite, Lexis Shepard's).
