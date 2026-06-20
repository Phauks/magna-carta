---
number: 35
slug: document-versioning-document-versioning-storage-tiering
status: Accepted
date:
area: Document versioning
---

**Document versioning & storage tiering:** revision history is **app-managed version objects**, not R2 native versioning (native lifecycle has **no noncurrent-version action** and gives no per-version storage-class control). Decouple a churning **`current`** key (overwritten on every save, Standard) from **immutable `vN` snapshots** cut deliberately — driven by Collabora's **`X-COOL-WOPI-IsAutosave`** header: version on **explicit Save + session-close**, **not per-autosave** (optional debounced checkpoint). Superseded versions transition **Standard → Infrequent Access** in place via S3 **`CopyObject`** (`x-amz-storage-class: STANDARD_IA` — server-side, no retrieval fee, ~33% storage cut on the coldest segment). **Tiering, never deletion** — every version kept forever, IA equally durable/available, safe under legal hold and append-only. **No compression** (corpus already compressed; would break the inline-preview range-stream path). WOPI `current`-overwrite is timestamp-guarded (`X-COOL-WOPI-Timestamp` → **409 / `COOLStatusCode 1010`** on mismatch). Native R2 versioning rejected.
