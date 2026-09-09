---
category: Added
audience: public
---

**File Safety & Scanning is live**, over `GET`/`PATCH /api/v1/firm/scan-policy` — four settings where the page had two invented seam rows: the scan tier, the suspicious-score floor, the flagged treatment, and the step-up preference. The engine behind them was already there and unchanged; the ingest consumer reads the policy at queue-consume time and the download route at access time, so a save reaches both with no re-ingest, and the route audits it.

`apps/web/src/lib/settings/server-backed-draft.svelte.ts` is new and is why the page needed no machinery of its own. The calendar's week start was the first server-backed setting and carried a draft hardcoded to its one definition; the scan policy is four settings, two of which share one nested object on the wire. So the staging, counting, confirming and saving moved into one generic draft over a declared field list, and `calendar-settings-draft.svelte.ts` now maps fields through it instead of reimplementing it — two callers, one implementation.

The field mapping FOLDS rather than merging: `applyTo(patch, value, settings)` lets each staged field see what the ones before it already wrote, which is what makes the tier and the score floor arrive as one `policy` object carrying both instead of two patches overwriting each other. Either one alone still sends the other's current value, because the server takes the pair or neither.

`SettingsDraft` gains `saveRefusal`, and the shared commit footer disables Save and states it. The score floor is the first setting somebody can type an impossible value into; refusing at stage time would make the field untypable, and sending it would return a 422 the person never sees, so the draft says why the button is dead.

## Public

**Your firm sets its own file-scanning policy.** Settings · File Safety & Scanning now works: choose how much of the scanner's rule set an upload is checked against, how confident a suspicious match has to be before it counts, and what your firm can do with a file the scanner flags — hold it, ask before opening it, or allow it with a mark. A flagged file is never deleted, whichever you choose.

Loosening what a flagged file may do asks you to confirm, because that is your firm deciding a file its own scanner distrusts may be opened.

Changes take effect on the next upload and on the next attempt to open a flagged file already on file — nothing needs re-scanning.
