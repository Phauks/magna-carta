---
category: Security
audience: public
---

**Statements attached to a trust reconciliation are malware-scanned before they are kept.** `POST /api/v1/trust/bank-reconciliations/{reconciliationId}/files` now runs the bytes through the firm's scan engine and the firm's scan policy before writing them to the bucket. A flagged file is refused with a `422` and nothing is stored; an engine that is bound but not answering is a `503` with nothing stored; a deployment with no engine keeps the file unscanned, as every other upload path does. The New Reconciliation window now says when a chosen file was not kept, instead of opening the period without it.

## Public

**Bank statements are checked for malware.** A statement attached to a reconciliation is scanned before it is kept, and one that fails the check is refused with a message saying so.
