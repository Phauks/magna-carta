---
number: 36
slug: client-portal-client-portal-unified-grant
status: Accepted
date:
area: Client portal
---

**Client portal — unified grant sharing model:** every share (matter / folder / file) is one first-class **`PortalGrant`** (recipient = Directory entity, scope + optional R2 version-pin, capability subset, per-share **assurance level**, optional expiry, status + full audit); a recipient's portal is the **aggregation** of their active grants. Recipients are **always Directory entities** (no shadow user list; conflict-checkable). **Opt-in folders:** folder shares are live for files but **child folders stay private until shared**; "share whole matter" grants only currently-shareable folders; shareability is **visible** in the File Manager. Capabilities: view / download / upload / comment / esign, with **uploads quarantined** for staff acceptance (never silently mutate matter files). **Per-share assurance** (magic-link | account | account+2FA); portal accounts are a **distinct external principal type in the control-plane D1**, never staff RBAC. **Instant revocation + optional expiry + metadata-only audit.** Enforced in the firm-scoped **DAL**: **per-firm isolation** and an **ethical-wall / least-privilege invariant — a grant never exposes more than the sharer's own current access** (walled-off staff cannot share a matter). Reuses the bulk-download engine, inline preview, and the portal/payments/observability surfaces scoped by grant. Deferred: per-recipient watermarking, ad-hoc non-Directory recipients, per-file in-folder exclusions. Rejected: **per-matter-only sharing config** (no file-level or cross-matter aggregation) and **link-first/Drive-style sharing** (breaks Directory-recipient + per-share-assurance constraints, weakest audit).
