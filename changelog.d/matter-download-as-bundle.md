---
category: Added
audience: public
---

**Download as Bundle in the matter file manager.** `apps/web/src/lib/file-manager/bundle-dialog.svelte` asks for the format, compression, an optional password, a 7z part size, folder layout and a hashed contents list, and `bundle-request.ts` turns the choices into a `POST /api/v1/downloads/zip` body. A plain zip leaves the options out so it keeps the fast lane. The module also reads all four answers: a streamed archive, links to a built bundle, a background build polled through the bundle-status route, and a single-file redirect. The menu items are `downloadBundle` on a selection and on the empty space (the whole matter). The modal-heading lint gains the verb "download".

## Public

**Download a selection, or the whole matter, as one bundle.** Right-click files and folders on a matter and choose **Download as Bundle**, or right-click the empty space for **Download Matter as Bundle**. Pick Zip or 7z and how hard to compress it. You can also add a password, which encrypts it with AES-256, split a 7z bundle into parts that fit an email or a disc, flatten the folders, and include a contents list with each file's fingerprint. Large bundles build in the background and download when they are ready.
