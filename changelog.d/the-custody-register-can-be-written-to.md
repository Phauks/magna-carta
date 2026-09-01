---
category: Added
audience: public
---

**The Custodian register gained its entry paths, and lost three tabs.** The whole `custody.*` write surface already existed and no screen reached any of it, so the register could be read and never begun: `apps/web/src/lib/custodian/custody-api.ts` had no POST at all and the primary action was a `SoonAffordance`.

Three modals over the existing endpoints, with `packet-draft.ts` holding the readiness and request assembly for all three so what is sent, and what stops a submit, is pure and tested rather than living in a component nobody can exercise without driving a dialog. An untouched optional field is absent from the body rather than sent empty, which is the difference between "nobody was asked" and "the firm was told the depositor is nobody" on an append-only record.

The screen is now one table: the By Owner, Holds and Due tab strip and its four panels are deleted, the status select above the rows is gone (Status is a column with its own filter, per the matters docket ruling), and the local search box is gone ahead of the centralized search component, with the server's `search` filter left plumbed for it. `packet-register.svelte` lends its grid back to the surface so the show/hide-columns and clear-filters controls sit in the screen's one action row.

Two shared-surface changes ride along. The data-table recipe's placeholder cell now sets `white-space: normal`: it inherited the grid's `nowrap`, so a wordy empty state was one unbreakable line that widened the table past its own frame and dragged the empty state off the inline end, on any surface, not only this one. And custody `out` renders as "On loan" rather than "Out": the two states in which property is off the shelf are `out` and `released`, they are opposites, and neither "Out" nor a first pass at "Checked out" separated them — both only say it left the building. "On loan" carries the return, and is the ledger's own noun for it (the row records a `borrower` and a `due_back_on`). `released`'s hover now states that custody has ended. The movement label is untouched: the act is still "Checked out" in a packet's history.

## Public

**You can now put things into the safe custody register from the screen.** Until now the register could be read and not written: there was no way to log a packet, describe what was inside one, or file a scan against it.

**New** logs a packet: what the firm is holding, whom it is held for, and which container it goes into, plus who handed it over and when, notes, and a number carried in from a paper register where the label already has one. Inside a packet, **Describe An Item** records one thing it contains, with its type, its own date, and the irreplaceable-original flag your firm's item-type list pre-answers. **File A Copy** links a document the firm already holds to the packet, or to one item in it, as a scan, photograph, receipt, appraisal or correspondence. Logging from a matter's Custodian section fills in the matter and asks you the rest, because property belongs to a person rather than to a file.

The register screen is now one table. The By Owner, Holds and Due tabs are gone: two of the three were the register narrowed, and a firm not yet using holds or due-back dates was being shown empty screens to discover that. Narrowing by status happens in the Status column, and the storage tree still narrows the register to a whole branch.

A packet somebody has taken out now reads **On loan** rather than **Out**, so it cannot be mistaken for one that has been **Released**. The two are opposites and the labels were not saying so: a loan is still the firm's and has a due-back date against it, where a release has ended the firm's custody for good and is the one step that cannot be undone. Hovering either now says which it is.

An empty register no longer runs off the right-hand edge of the screen.
