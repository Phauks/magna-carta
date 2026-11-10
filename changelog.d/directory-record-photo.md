---
category: Added
audience: public
---

**A directory record carries a picture.** A new per-firm table, `directory_entity_photo`, holds one picture per person or organization; the bytes live in the firm's bucket under `directory-photo/<entity>/<sha256>.<ext>`, written before the row and swept after a replacement. `GET`/`PUT`/`DELETE /api/v1/directory/entities/{id}/photo` and `GET .../photo/content` follow the staff-photo route (PNG or JPEG only, idempotent writes, audited as `directory.entity.photo_changed` and `directory.entity.photo_removed`). The browser crops to a 512-pixel square JPEG before upload (`photo-crop.ts`, `photo-crop-dialog.svelte`), the record window shows it through `ActionDialog`'s new `leading` snippet, New Person can add one before saving, and the contact card embeds it as `PHOTO`.

## Public

**A person or organization in the Directory can have a picture.** Press the circle beside the name at the top of a record to add a photograph or a logo, then drag and zoom it until it sits inside the ring. Only the square you choose is saved. Pressing the picture again lets you change it, view it full size or remove it. New Person has an Add Photo button too, and a downloaded contact card now carries the picture.
