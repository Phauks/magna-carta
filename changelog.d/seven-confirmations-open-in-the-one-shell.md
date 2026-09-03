---
category: Changed
audience: internal
---

Seven more panels open in `ActionDialog`, and the shell gained the outcome one of them needed.

The file manager's three (delete a folder, restore a file, the upload destination), the note and party removals, the settings recap before a save, and the attachment detach inside `RecordAttachments` — the last a design-system component that composed its own `AlertDialog` while registered. The file-manager panels stop taking a `running` flag from their host: the host returns the outcome and the shell owns the busy state; their host-worded failures render in the notice slot. The upload panel's report column becomes the context pane beside its decision, and its bar hint moves into the body.

`ActionOutcome` gained `"done"`: the panel stays open with nothing left to ask — the commit leaves the bar, the dismissal reads Close, the guard stands down — and `fields`/`context` are handed `done`. The upload panel saves its destination and stays to show the batch landing; the two send panels still to migrate will use it the same way. Seven allowances leave `tooling/lint-one-ui/registry.json`; nineteen remain, eleven of them named exclusions.
