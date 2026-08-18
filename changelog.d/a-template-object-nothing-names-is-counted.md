---
category: Fixed
audience: internal
---

**Template registration leaks bytes, and until now nothing could even say how many.**

Registration writes its bytes to R2 inside the idempotent effect and before the scan, so a
registration that throws in between leaves a full copy behind. Each attempt mints a fresh key, so
retries multiply it, and the storage reconciliation never reaches them: that pass lists `files/` and
`bulk/` only, and corrects the meter rather than deleting anything.

A daily pass now **measures** the leak: per firm, it walks `templates/` and counts every object no
`document_template_version` row anywhere in the fleet names, that is not a staged upload, and that is
older than a 24-hour grace period.

**It deletes nothing, and that is the finding rather than a shortcut.** The rule "delete the
complement of the live set" is only as safe as the live set is complete, and completeness cannot
currently be verified. A read that FAILS can be caught, and is — one failure disarms the whole pass.
A read that SUCCEEDS AND RETURNS NOTHING cannot be told from a firm that holds no templates, because
the per-firm database object self-migrates on construction: address it under the wrong name and it
answers zero rows from a brand-new empty database rather than throwing. The residency seam already
documented in the database proxy makes that reachable — the first jurisdiction-bound firm will be
addressed with a jurisdiction its statements carry and this pass does not.

Arming the delete wants the invariant to become checkable, most plausibly by stamping each object
with the firm that wrote it, so an orphan is decided against ONE firm's rows and the fleet-wide union
disappears along with its blast radius. That is a design decision with a real trade, and it is filed
for the owner rather than taken here.

**Two smaller things the review corrected.** The candidate count is DISTINCT KEYS, not sightings:
template keys carry no firm segment and every firm resolves to the same bound bucket, so each firm's
pass walks the same prefix and a per-sighting count would scale with tenancy rather than with the
leak. And the per-firm cap is a budget per PASS, not per that firm's own objects — the fleet-wide
ceiling is the cap times the number of active firms, which the earlier wording claimed the opposite of.
