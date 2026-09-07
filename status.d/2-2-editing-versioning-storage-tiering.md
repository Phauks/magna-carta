---
slice: 2·2 — Editing + versioning & storage tiering
group: phase-2
order: 2
research: n/a
spec: done
plan: done
built: done by="Opus 4.8"
ui: in-progress
load-profile: done by="Opus 4.8"
tested: todo
branch: main
active-work: docs/active-work/claude/text-document-editor-support-arvpgv.md
next: Verify the Collabora frame fills on the deployed site; the spreadsheet and presentation lanes; the reconcile screen.
link-spec:
link-plan:
adrs:
blocked-by:
---

Collabora, one container per open document; `magna-carta-edit` deployed; reconciled onto the FirmDatabase DO. Stage-2 doc-open verify pending. The editor screen exists at /documents/{id}/edit: the file manager's Open opens it in a new tab, the WOPI token is form-posted into the Collabora frame for word-processing formats, and plain-text documents get an in-app editor that saves a new version.
