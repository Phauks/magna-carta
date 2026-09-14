---
category: Changed
audience: public
---

**The File Workbench becomes a sidebar destination in the Firm group, at `/file-workbench`, starred by default.** The tool catalogue had it inverted: of its twenty manifests, eleven are the `files` subject group, and ten of those eleven map one-to-one onto the workbench's own capability tabs, so the listing offered eleven doors into one room with the room filed alphabetically between two of its own doors. Firm rather than Workspace on a scope test rather than an importance one, since nothing brought here is filed, versioned, or remembered.

The route moves off `/tools/` because destination currency is a path-prefix match, so a workbench still under `/tools/` would light up the Tools row alongside its own. The manifest row stays, since contextual surfaces query the catalogue by context tag, so `ToolManifest` gains an optional `route` and `toolRoute()` becomes the one derivation every link-builder goes through. The palette's tool provider skips a promoted tool, which the destination registry already lists. `FILE_WORKBENCH_BACK` is deleted and the screen header drops its `back="tools"`: a top-level destination has no way back.

## Public

**The File Workbench has its own place in the sidebar now, under Firm.** It used to be one row inside Tools, four clicks in, which was the wrong way round: the file utilities listed there are the workbench's own tabs. Since the way you start is by dropping a file on it, it needed to be one reach away from wherever you already are.

You can move it or hide it like any other sidebar row, and Tools still lists it alongside the file utilities it runs.
