---
category: Changed
audience: public
---

**The document-opening panel streams the open instead of ticking boxes.** `openFeed` in `apps/web/src/lib/documents/editor-open-progress.ts` turns the stage marks into lines as they happen (a finished stage is one past-tense line with its second; the stage under way says what it is doing and why it takes the time); `openPace` fills a `Progress` bar over `TYPICAL_OPEN_MILLISECONDS` (30 s, the owner's own opens) with the usual time said beside it, never a fraction of the stages; Retry now waits for `RETRY_AFTER_MILLISECONDS` (45 s) rather than the loading region's 15 s; the full ProgressSteps sequence and the failure rows sit behind a Show details control, shown unasked once the open has stopped. The "N seconds so far" line is gone. The editor container moves from `standard-1` to `standard-2` (one vCPU, 6 GiB) on the owner's ruling after the editor's hardware warning; `docs/operating-costs.md` carries the new figure.

## Public

**Opening a document now tells you what is happening while you wait.** Instead of a list of steps that tick off, the panel reads like a log: each stage appears as it finishes, with the moment it did, and the stage under way says what it is doing and why it takes the time it takes. A bar fills over the half minute an open usually takes, and says so; past that it tells you the open is running long. Retry is offered only after forty-five seconds, since an open past the usual time is far more often about to finish than stuck. **Show details** opens the full sequence with its timings, and the details appear on their own if the open stops. The editor also runs on a larger machine now, so typing should feel quicker.
