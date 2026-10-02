---
number: 458
slug: firm-brand-images-with-an-office-letterhead-fallback
status: Proposed
date: 2026-09-11
area: Core domain
summary: "Firm branding is firm-wide with a per-office override, not per-office alone and not firm-wide alone. The firm holds a primary brand image and a bounded set of additional images, content-addressed by the SHA-256 of the bytes and stored in the firm's own bucket under that hash with the same facts the office letterhead logo records; an office's letterhead prints its own logo where it has set one and the firm's primary mark where it has not, resolved in one place on the read routes. The set answers whole rather than by page because a letterhead resolves it in one read, and it is bounded by construction (twelve additional images) so that stays true. Promoting a mark demotes the previous primary rather than removing it, and the rows live in @magna-carta/locations beside the office logo because the two are one family of facts."
---

**A firm with one office should set its mark once, and a firm with five should be able to differ where it really does.**

**Context:** The letterhead logo already existed, per office: `location` carries the object key, the
content type, the size, the hash, the pixel dimensions and a printed width, the bytes live in the
firm's bucket, and the assembly engine draws the mark from them. What did not exist was any way to
set it from the product, and any notion of the firm's OWN identity: Firm Profile held one field, and
the owner's ruling on the settings surface asked for the firm to be able to upload an image, or
images, for use across the platform.

The question that opened was where branding lives. Per office alone means a firm with one office
still has to find its office to set its mark, and a firm with five sets the same mark five times.
Firm-wide alone means an office whose letterhead genuinely differs, a branch that trades under its own
name, has nowhere to say so, and the per-office machinery already built goes to waste.

**Decision:** Firm-wide, with a per-office override. The firm holds a **primary mark** and a bounded
set of **additional images**; an office prints its own logo where it has set one and the firm's
primary mark where it has not. The fallback is resolved in one place, on the office's read routes
(`letterheadSource` on the detail, and the bytes route serving whichever applies), so every reader of
"what does this office print" gets one answer.

Four things follow:

**Content-addressed.** A brand image's identity is the SHA-256 of its bytes, which is also the object
key's name. Uploading the same mark twice is the same row, re-filed under the new role or caption, and
a replaced mark never overwrites the object a document was already produced from. A minted identifier
would have added a second identity for a thing that already has an unforgeable one.

**Promotion, not replacement.** Setting a new primary demotes the previous one to an additional image.
Choosing a new mark is not a reason to lose the old one; a firm that wants it gone removes it, which
asks first.

**Bounded, and answered whole.** The read returns the primary and the additional set as a shape, not a
paged list, because a letterhead resolves it in one read and a document cannot page. That is honest
only while the set is small, so the write refuses a thirteenth additional image rather than the read
growing a cursor later.

**One package.** The rows and their service live in `@magna-carta/locations` beside the office logo.
They are one family of facts about what a letterhead prints, read together wherever one is drawn; a
package of their own would have put the two halves of the fallback in different homes.

**Consequences:** The assembly engine's resolver (`packages/document-assembly/src/resolve.ts`) still
reads only the office's own logo; the fallback reaches documents once that resolver takes the firm's
primary mark as the second source, which is the change this decision asks for next. The brand images
are stamped with the existing `letterhead-image` object class; a class of their own is a one-line
addition to `@magna-carta/object-dimensions` when somebody wants to count them apart.
