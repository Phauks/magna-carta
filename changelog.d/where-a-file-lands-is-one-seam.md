---
category: Added
audience: public
---

**A central save target.** Every download in the app already passed through one `saveExport` call, so
where files land became a single decision rather than four. `$lib/export/save-target.ts` writes into a
folder the member chose where the browser can do that, and hands the file to the browser exactly as
before where it cannot.

The state of the web decides the shape, and it is progressive enhancement rather than a capability
claimed everywhere: only the File System Access API lets a page choose a folder, and today Chromium
implements it while Firefox and Safari ship only the sandboxed Origin Private File System. What
Firefox and Safari DO have is the browser's own "always ask where to save" — a real local-disk picker,
just one the person turns on rather than one a page opens. `Settings · Downloads` shows a working
picker where the browser can, and names that browser setting where it cannot, rather than rendering a
control that does nothing.

Two properties the module holds, both stated in it. **It never fails a download**: a lapsed
permission, a folder that moved or was deleted, a picker that throws — each falls back to the
ordinary download rather than costing the member the file. **The folder never leaves the machine**: a
directory handle cannot be serialized to a server, so it lives in this browser's IndexedDB, which is
exactly why the folder is per browser while save-immediately is per member.

**Also fixed, and a consequence of the new default:** when the shelf refuses an export, the default
path had produced nothing at all — no file and no item, which is worse than the behavior it replaced.
It now falls back to downloading the file and says plainly that it was not kept.

## Public

**Choose where your downloads go.** In **Settings · Downloads**, pick a folder once and exported files
are saved straight there. Not every browser lets a website choose a folder — Chrome and Edge do; in
Firefox and Safari the page will tell you to switch on your browser's own "always ask where to save
files", which does the same job. Either way your file always arrives.
