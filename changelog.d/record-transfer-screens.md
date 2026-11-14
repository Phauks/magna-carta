---
category: Added
audience: public
---

**The record transfer has its screens.** `/record-transfer` lists the firm's runs and starts one; `/record-transfer/[runId]` is the file-by-file workspace the owner chose: the run's files with the counts of their latest pass, the Before Cutover lines, and three tabs for the selected file (Columns, Report, Sample). The Columns tab is built from the file's preview and turns its assignments into the mapping rules of `packages/record-transfer/src/contract.ts` (`apps/web/src/lib/record-transfer/column-mapping.ts`); a file that has been run opens on the rules its latest pass was asked with. A requested pass is polled until it ends. The destination is in the Firm group behind `firm:transferRecords`. The words for every rejection, finding and failure code are in `apps/web/src/lib/record-transfer/transfer-run-view.ts`. The trust-balance and sample-check lines of Before Cutover stand as not run and not done: nothing computes them yet. `ChoicePicker` gains an `invalid` prop, and the modal-header lint's verb list gains "match".

## Public

**Record Transfer: bring your firm's records in from the system you are leaving.** Owners and Admins have a new Record Transfer entry under Firm in the sidebar. Start a run, upload a file of people, organizations or matters, say what each of its columns has in it, and run it. The file list shows how many rows arrived, how many are waiting on another record and how many were rejected. The Report tab lists each of those rows with its line in the file and the reason, and the Sample tab links to records the run created so you can check them against the file. Running a file again brings nothing in twice. LEAP is the first system supported.
