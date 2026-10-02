---
number: 453
slug: a-deployment-refuses-to-run-a-development-adapter-and-verifies-what-an-upload-needs
status: Accepted
date: 2026-09-10
area: Observability & diagnostics / Tenancy & data isolation
summary: "The credentials that select the real provisioning and presigning adapters are required by the deploy gate, so a production deployment can no longer run the development adapters — which recorded a bucket name for every firm they provisioned and created no bucket, with nothing reporting it. Beside that, the preconditions of a browser upload — the firm's bucket exists, carries the ingest notification, the expiry rules and the CORS policy, and the presigner's own credential signs a request it honours — are verified from the server side, where a refusal has a status code, by one function run from one button on the File Safety & Scanning screen; idempotent settings are re-applied in place, and a missing bucket or a mis-scoped key is named with its fix. Deliberately absent, after a first draft carried them: a deployment-mode object, a startup refusal, a status line, a daily sweep, and a readiness cache on the firm row — each was machinery for a fact the gate or the button answers in one piece."
---

**A deployment cannot run a development adapter, and a firm's upload preconditions are verified from the server side, by a button, with the idempotent ones repaired in place and the rest named.**

Production behaviour had been selected by which optional secrets happened to be set. Absent the provisioner's token the development adapter ran, recording a bucket name for every firm and creating nothing, and nothing said so until the firms could not upload — a fault that was diagnosed from the browser three times, because the one hop of an upload that fails is the one hop that bypasses every Worker (the presigned PUT, which must: the request-body cap forbids proxying). Five different faults produce that one symptom.

Resolution: `CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER` and `CLOUDFLARE_ACCOUNT_ID` join `secrets.required`, so the deploy stops rather than serving through a development adapter; and `verifyUploadReadiness` checks, in the order they must hold, that the firm row names a bucket, the bucket exists, the three settings the provisioner owns are in place (re-applied, not diffed), and the S3 credential signs a request the bucket honours — run by `POST /api/v1/firm/upload-readiness` from the File Safety & Scanning screen, audited, and pointed at by the upload dialog's storage-failure line. Design: `docs/specs/2026-09-10-upload-readiness-and-deployment-modes-design.md`.

Rejected: proxying uploads through the Worker to observe them; a check that creates missing buckets; and — after the owner's ruling that best means easy to diagnose, not overcomplicated, and fast — the first draft's deployment-mode object, startup refusal, status line, telemetry event, daily repairing sweep, provisioning-time fence and firm-row cache, each of which was a second way of learning a fact the gate or the button already answers.
