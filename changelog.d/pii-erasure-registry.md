---
category: Added
---

**A PII/erasure registry now attributes every personal-data table to a data subject.** A declarative
manifest (`PII_TABLES`, sibling to `PROTECTED_COLUMNS`) plus a coverage fitness function force every
per-firm table to be classified as PII or explicitly non-PII, so no personal-data table can escape
subject attribution — the seam GDPR subject-level erasure (Art. 17) will traverse. A drift tripwire
keeps it a superset of the Directory merge's reference set. The erasure orchestrator itself is deferred.
