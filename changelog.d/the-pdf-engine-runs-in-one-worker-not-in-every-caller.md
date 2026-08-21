---
category: Changed
audience: internal
---

**The API Worker no longer bundles the PDF engine — it calls the worker that already hosts it.**
`apps/api-worker` had two in-process uses of `@magna-carta/pdf`: the AcroForm read, scrub, and fill
behind fillable-PDF template registration and assembly, and the text-layer reader that is one route
of composite text extraction. Both were the same pinned Rust crate compiled to WebAssembly, which is
why that Worker's bundle could only be built somewhere the artefact had been produced.

Both now go over the existing `SIGN_SERVICE` binding to `apps/sign-worker`, which was already
carrying that engine for the platform seal. The engine's HTTP surface is defined ONCE, beside the
engine, in `packages/pdf/src/service.ts` — narrow and byte-oriented: the document crosses as raw
bytes (multipart for a fill, so a filled form is not base64-inflated by a third) and comes back as
raw bytes, and nothing on the far side decides anything about the document. Which box gets which
value and whether a filed form is interactive or flattened stay where they were, in
`@magna-carta/document-assembly` and `apps/api-worker/src/assemblies/pdf-form-engine.ts`; the finish
is REQUIRED on the wire so it cannot be lost by omission on the way across. There is still exactly
one filler — it runs somewhere else.

**The three states are the substance of the change, not the transport.**
`apps/api-worker/src/documents/pdf-engine-binding.ts` names them on the terms the malware-scan wiring
already states: no binding at all, bound and answering, bound and failing — and only the first two
are verdicts. A 5xx is never reported as "this PDF has no form fields" or "this document has no
text". The two callers resolve the non-verdict states differently, because the conditions differ:

- **Document assembly** (a queue consumer). No engine at all fails the job terminally with the new
  `form-engine-unavailable` code — a redelivery cannot deploy a service, exactly as an undeployed
  office suite terminally fails a PDF conversion. An engine that is deployed and did not answer
  RETRIES: that is not "this form cannot be filled", it is "nobody looked", and the terminal rule
  exists to stop a wrong document being filed rather than to discard a job a redelivery completes.
  Both file nothing.
- **Template registration** (a route). Both non-verdict states answer a retryable 503 naming the
  engine, the answer `scan-diagnose` already gives for the identical posture — a 422 would tell an
  administrator to re-cut a document that is perfectly good. Nothing is registered; the upload stays
  staged.
- **Text extraction.** No binding simply removes one route: the document falls through to
  recognition, as it does for a PDF this reader cannot read. A bound engine that faults is reported
  transient so the queue retries, and recognition is deliberately NOT tried instead — the text layer
  is what decides whether a page needs recognizing at all.

`prepareFormTemplateVersion` no longer swallows a throw from its scrub seam into `scrub-failed`: the
seam reports a refusal by returning undefined, and a throw means the engine did not run.

This removes one of the reasons `apps/api-worker`'s build needs Docker. The decryption and email
WebAssembly imports remain, so `rust-wasm-build` is unchanged and still required.
