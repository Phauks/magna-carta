---
category: Changed
audience: public
---

**The back-to-matter button sits first on the editor's bar, carries the matter's number, and takes the editor's icon colour.** The editor appends a host's buttons after its own and shows the icon as given (`insertBefore` is honoured only by its classic toolbar), so the edit worker now serves the platform's stylesheet on the editor's origin (`apps/edit-worker/src/editor-stylesheet.ts`, at `/magna-carta/editor.css`, linked into the page's head as it streams through, under the page's own `style-src 'self'`): the shortcuts row is laid out as a flex line with the host's cell ordered first, and the icon is inverted under the editor's dark theme. `backToMatterButton` takes the matter's number as the button's word, threaded from the edit page's matter record; a matter without one reads "Matter".

## Public

**The way back from a document is now the first button on the editor's bar, showing the arrow and the matter's number.** Its icon matches the editor's own, in the light and the dark theme alike. A matter that has no number yet reads "Matter".
