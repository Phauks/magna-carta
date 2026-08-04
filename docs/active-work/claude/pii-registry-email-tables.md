# claude/pii-registry-email-tables

**Scope:** Classify the six email-filing per-firm tables (`email_thread`, `email_message`,
`email_matter_link`, `email_participant`, `email_attachment`, `email_capture_address`) in the
PII/erasure registry, which they were added to the schema without — leaving the registry's coverage
fitness function red on `main`.

**Status:** Done; coverage test and the full `@magna-carta/data-access` suite green. Awaiting merge.

**Expected files:** `packages/data-access/src/pii-registry.ts`, plus a changelog fragment and a
decision fragment recording the value-keyed subject key the participant/sender rows introduce.
