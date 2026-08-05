---
category: Added
---

**A firm's own fields as merge fields.** Every custom field a firm has defined on matters is now a
merge field a template can bind, written `{{custom.<field handle>}}`. Binding is by the field's
**handle, never its name**, so renaming "Retainer cap" to "Engagement cap" changes nothing a
registered template has to be re-registered for. The catalogue is derived per firm at read time, so
the field list a template is authored against, the check that runs at registration, and the check that
runs at assembly all see the same fields — which is what makes drift detectable: a template bound in
March to a field archived in June fails in September naming the field, rather than quietly leaving a
hole. An archived field resolves as a reported absence and shows a visible marker. Values render at
the scale their own definition declared, reusing the custom-fields engine's value model rather than
restating it: the same stored `500` prints as `500` on a number field and `$5.00` on a currency field,
and a declared decimal scale renders by moving the point rather than by dividing. Picklist and
reference values print the option's or the referenced record's **label**, never the handle they store.
A whole template's custom fields cost **one** database read, however many it binds.

A custom field a document template binds can no longer be hard-deleted: like a field that holds
values, it is `field-in-use` and routes the administrator to Archive, where the binding stays
resolvable as a reported absence instead of leaving templates naming a field nobody can look up.

**The letterhead logo.** An office can now carry its firm's mark, and a template draws it with
`{{location.letterheadLogo}}` — resolved from the **matter's own office**, so a document assembled by
a member of one office on another office's matter carries the correct letterhead. The image must be a
PNG or a JPEG, decided by reading the file rather than by what the upload calls it; SVG, EMF, WMF, GIF,
BMP and TIFF are refused, and the reasoning is that a raster is all a printed mark needs while an image
format that is itself a document or a replayed record stream would put a markup and parser surface
inside every assembled document. The office sets only a printed **width**: the height follows from the
image's own proportions, so no template can print a stretched logo, and replacing a wide mark with a
tall one re-lays every letterhead out correctly without touching a single template. An office with no
logo set, or whose asset has gone, assembles with a visible marker rather than silently losing its
letterhead.

This is the assembly engine's first image work, so the emitted package is checked structurally rather
than textually: the image part, its declared content type, its relationship on the part that draws it,
and the drawing's reference to that relationship are each asserted, because a document whose words are
all correct and whose picture wiring is not is a document no reader will open — and nothing in a text
assertion can see it.
