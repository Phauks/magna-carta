---
category: Added
audience: public
---

**A record transfer takes a source file of up to 4 GiB, given in pieces.** Three routes under `/api/v1/record-transfer/runs/{runId}/file-uploads` start an upload, take a piece of 32 MiB and complete it. The pieces go straight to the firm's bucket; the file joins the run only when the upload is completed and its digest read, and the same bytes are still refused a second time. Firm buckets provisioned from now on reclaim the pieces of an upload nobody completed.

## Public

Record Transfer now takes files of up to 4 GB, so a whole table from the system you are leaving can be uploaded in one go.
