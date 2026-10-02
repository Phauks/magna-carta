---
number: 465
slug: a-modal-subtitle-carries-a-typed-record-reference
status: Accepted
date: 2026-09-14
area: Design system
summary: "The subtitle slot on ActionDialog and RecordWindow stops taking a bare string and takes a RecordSubject — an optional RecordReference (kind, number, and a standing of drawn, tentative or preview) plus short facts — which the design system renders. The three standings are the domain's own: a matter number is drawn, a consultation number is tentative and outlives the matter opening, and a preview is what the next record would take, shown before the save with the words that say so. Removing the string arm is the mechanism rather than a side effect: eighteen of fifty-four subtitles were the explanatory prose the owner struck from the New Check panel on 2026-09-08, four billing panels mixed a number and a sentence behind three different separators, and a slot typed string accepts all of it. A source scan, tooling/lint-modal-headers, then reads the heading's form against the panel's kind and asserts that a panel holding a record number shows it."
---

**A slot typed `string` is a slot with no contract, however carefully its doc comment is written.**

**Context:** `ActionDialog`'s `subtitle` has said "What is being acted on, named once. A record's own
reference belongs here and only here" since the shell was built, and `RecordWindow`'s says the same.
The owner ruled on it twice on 2026-09-08 — a panel does not explain its own subject, and a record a
person quotes out loud carries a number it is identified by before it is saved. At the head of this
branch, 18 of 54 subtitles across 82 panel openings were paragraphs about what a subsystem is for,
four billing panels put a number and a sentence in one interpolated string behind `·` in three
places and `—` in a fourth, `tabular-nums` was hand written 138 times, and the preview-before-save
had reached exactly one file — the call log, which is where the owner asked for it. Every one of
those is a call site doing something the prop's own documentation forbids, and nothing could see it.

**Decision:** `subtitle` takes `RecordSubject | Snippet`; the bare `string` arm is removed.
`RecordSubject` is an optional `RecordReference` — `kind` ("Matter", "Invoice", "Call"), `number`,
and `standing` of `"drawn" | "tentative" | "preview"` — plus a list of short facts. The design system
renders it: the kind and number together, `tabular-nums` on the number, and for a preview the call
log's own wording, "drawn when this is saved", which is now stated in one place rather than one file.
A null number renders "A number is drawn when this is saved." rather than silence. `tentative` is not
a synonym for `preview`: a consultation number is really carried, survives the matter opening, and
still resolves a document filed under it, which the platform already models in
`packages/matters/src/numbering/consultation-scheme.ts`. The snippet arm stays for a subject carrying
real markup.

**Consequences:** Every call site that carried prose loses it — deleted where it restated the
heading, moved beside the field it explains where it was load-bearing, on the owner's 2026-09-01
ruling. Panels that hold a record's number and showed something else now show the number, which is
the traceability the removal was asked for. The separator stops being a per-panel choice, because no
call site writes one. `tooling/lint-modal-headers` can then check facts rather than guess at strings:
it reads the heading's grammatical form against the panel's kind, rejects a sentence-shaped fact, and
asserts that a panel whose own source holds one of the platform's record numbers passes it to the
reference — with the registry of what counts as a record number derived from the schema's `*_number`
columns, so a record kind that grows a number grows a rule with it. The shell's domain-blindness is
untouched: `kind` is a caller's string and the design system still names no record type.
