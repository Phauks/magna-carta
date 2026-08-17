---
number: 365
slug: there-is-no-home-for-shipped-template-content-yet
status: Proposed
date: 2026-08-16
area: Document automation
summary: "The asset-schedule starter template that closes slice 4·3·3 is NOT built, and the reason is a missing mechanism rather than missing content: nothing on `main` distributes a document template the platform authored. There is no committed template package, no template seed in either migration lineage, no template role, no adopt route, and `document_template.source_form_key` does not exist — the only `.docx` in the repository is a LibreOffice container test fixture. The document-automation design named cross-firm template distribution as an open question to settle 'before the first real client', and the answer to it was subsequently designed in the Nevada court-form library (a pure reference-data package a firm ADOPTS through the ordinary registration pipeline, with two provenance columns and supersede-not-replace), whose build is gated on unanswered owner flags N1 through N5. Building a bespoke second distribution path for one asset schedule would pre-empt that answer, duplicate the machinery, and leave two ways a firm receives platform-authored content. The register's own half is complete — eleven asset subjects with `itemFields`, one batched source, and the repeating-block vocabulary all ship — so a template a firm authors and uploads works today; what is missing is only the supplying of one. Two owner questions are named: whether shipped starter content rides the court-form adoption path once N1–N5 clear, and what an asset schedule should actually say, which is a product opinion about a legal document rather than an engineering choice."
---

**The asset-schedule starter template is not built. The content was never the blocker — there is
nowhere on `main` to put a template the platform wrote.**

**Context.** Slice 4·3·3's last task asks for "a starter template assembling the schedule from the
asset subjects with a repeating block, **in the document-automation starter content** — not a court
form, and the user documentation says so in those words."

The register's half of that is done and was verified rather than assumed. `MERGE_SUBJECTS` carries
the eleven `assetClass` subjects, each collection-only with its `itemFields`; `resolve.ts` fills them
from one batched source; the block vocabulary in `src/blocks.ts` walks a collection a whole paragraph
or a whole table row at a time; and the keys are in the committed golden list. A firm that authors a
schedule in Word and uploads it through the ordinary template registration works **today**.

The phrase that does not resolve is "the document-automation starter content". It does not exist:

- No template package and no committed `.docx` — the only one in the repository is
  `containers/libreoffice/tests/fixtures/acceptance.docx`, a conversion test fixture.
- No `INSERT INTO document_template` in either migration lineage; provisioning seeds catalogs, never
  templates.
- No template role, no adopt route, and no `source_form_key` / `source_form_revision` columns on
  `document_template`.

That absence is deliberate and already recorded. The document-automation design left cross-firm
template distribution as an open question — the `template_field_key` seam "anticipates curated
starter content living in the control plane. Whether document templates get the same treatment is out
of scope here and worth deciding **before the first real client**." The Nevada court-form library
design then answered it: shipped content is compiled reference data in a pure package on the
`@magna-carta/trust-jurisdictions` model, which a firm **adopts** — registering an ordinary template
through the existing registration pipeline and the one ingest chokepoint, with two provenance columns
recording where it came from and a corrected revision **superseding** rather than overwriting a
template the firm may have edited. That design's build is gated on owner flags N1 through N5, none of
which is answered; ADR-0255 predates the design and directs the library's curation without settling
them.

**Decision.** Do not build it here, and do not invent a second way to ship content.

The one-off alternatives were considered and each is worse. **A committed `.docx` plus a seed
migration** writes platform content into every firm's database, which is precisely the shape the
court-form design refused, because the correction path then becomes a migration against every tenant
instead of a package release. **A bespoke adopt route for this one template** builds the same
machinery the court-form work will build, differently, and leaves a firm receiving platform content
by two mechanisms with two provenance stories. **Waiting to author the content** does not help — the
content is not what is missing.

**Two owner questions, and they are different in kind.**

**The mechanism.** Does shipped starter content — a schedule, an exhibit list, a separator page, and
whatever follows — ride the court-form adoption path once N1 through N5 clear, or does the platform
want a distribution path for non-court content that does not wait on those flags? An asset schedule
is not a court form and carries none of the copyright or attorney-review weight that gates the Nevada
library, so it could reasonably go first; that is a scoping call, not a technical one. Two other
slices are queued behind the same answer: the exhibits plan wants a committed separator-page starter
template, and its list template has the same dependency.

**The content, which is a product opinion.** What an estate asset schedule says — its heading and
whether it names the court, whether it groups by class or lists flat, which columns appear and in
what order, whether unvalued assets are listed or counted, whether encumbrances and equity print
beside a value or in their own section, and what the document calls itself when it is deliberately
not the inventory any particular court accepts — is a decision about a document a firm will hand to a
client or attach to a filing. Neither the matter-assets design nor ADR-0255's ratified A-flags
specify any of it: the design says only that the schedule is "the probate-inventory _shape_, without
the form", and lists what the READ returns. Every firm that provisions after this ships inherits
whatever is chosen, so it is the owner's to choose and not an engineering default.

**Consequences.** Slice 4·3·3's other half — the firm's own fields on an asset — ships. The asset
schedule remains available as the API read and as a template a firm authors for itself, and the user
documentation says so in those words rather than implying one is supplied. Nothing is committed that
would have to be unwound when the distribution answer arrives.
