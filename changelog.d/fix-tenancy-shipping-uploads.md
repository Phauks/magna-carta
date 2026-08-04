---
category: Fixed
---

- **A shipment's label PDF is now readable only by the firm that bought it.** The label download derived
  its object key straight from the URL's shipment id and streamed whatever bytes it found, with nothing
  proving the shipment belonged to the caller's firm — so any authenticated member of any firm holding
  `shipping:manage` could fetch another firm's label, and a label carries the recipient's full postal
  address. The read now resolves the label row through the caller's own firm-scoped database first and
  serves the server-recorded key from that row; a shipment outside the caller's firm finds no row and is
  answered `404` (absence, not a distinguishable refusal). Label objects are also keyed under the owning
  firm now (`labels/<firmId>/<shipmentId>.pdf`), so two firms cannot name one object even where they
  share a bucket. Labels bought before this change keep working — the read follows the key recorded on
  the label row, whatever its shape.

- **Uploads are presigned into, and read back from, one bucket.** The upload routes signed direct-to-R2
  URLs against the firm's own provisioned bucket while the ingest consumer and the storage sweeps read
  through the single bound R2 binding. On any deployment where those are not the same bucket — which is
  what firm provisioning actually creates, a per-firm `magna-carta-production-firm-<slug>` bucket — the
  bytes landed where nothing could read them: ingest would find no object, retry, and dead-letter, so
  uploads failed silently. Both ends now resolve the firm's bucket through one seam
  (`apps/worker/src/files/firm-bucket.ts`), which hands back the name a URL is signed against and the
  handle bytes are read through as a single answer, and refuses to mint a presigned URL for a bucket
  this Worker cannot read back (the new `R2_BUCKET_NAME` var names the bound bucket, since an R2 handle
  carries no name of its own). Every route that presigns or writes a firm's bytes goes through that
  resolver, pinned by a source scan.
