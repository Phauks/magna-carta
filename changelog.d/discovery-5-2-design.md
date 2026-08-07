---
category: Added
---

The design for the **discovery review workflow** — what happens between loading a corpus and handing
the other side a production. Design and slice plan only; no product code, and coding ships first.

**Coding that cannot lie about itself.** A review set gets a coding panel: groups of tags, where a
group is either a single choice (a document is responsive or it is not — never both, and the
database itself refuses the second answer) or a set of flags. The machine reads a tag's declared
meaning, never its name, so a firm can rename every label without changing what gets produced.
Every application and removal keeps its row forever with who did it and when; a bulk operation
freezes the exact list of documents it ran over before it starts, and undoing it removes precisely
what it applied and nothing anyone else did since. "Who tagged what, when, and how" is answerable
years later in one read, which is the question a meet-and-confer actually asks.

**Privilege review that produces the log, not just the label.** Marking a document privileged is
ordinary coding — same panel, same bulk tools, same record — and it opens a claim: which privileges,
and the described basis. The privilege log is generated from those claims plus the dates, authors,
and recipients already extracted at load time, and the generator is built so it cannot read document
content at all — a log entry describes the ground for withholding, never the substance withheld.
Clawbacks in both directions are recorded acts: a production received and clawed back leaves by a
recorded reversal, and a document we produced and claw back stays in the production record with the
clawback written beside it, because the numbers were served and are cited.

**Productions that are evidence.** A production freezes its membership into an explicit list before
anything renders, draws its Bates numbers as a block from a per-matter register so two productions
can never overlap, renders images with redactions burned by the engine that fails closed on any
verification doubt, hashes every artifact with the digest set opposing tooling verifies, and then
never changes again — corrections are new productions that say what they replace. Withheld
privileged documents appear on the log and never in the volume; a redacted document's produced text
comes from the redacted image or not at all, never from the original extraction; and the load file
names every Custodian of Record who held each document, including the ones whose copies were
deduplicated,
because "which custodians held this" is asked under oath.

Also settled: the review surface arrives together with the per-review-set access list that enforces
who may see it, every document read re-checks authorization at the moment of reading, walled review
sets are absent rather than greyed out, and nothing the review workflow writes can reach the firm's
natural-language search index — productions and coding live where that index structurally cannot
look. Four questions stay open for the owner: whether privilege coding needs its own permission
tier, whether withheld documents consume Bates numbers or placeholders, what happens by default when
privilege splits an email family, and the privilege log's delivery format.
