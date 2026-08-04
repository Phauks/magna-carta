---
category: Fixed
---

- **A file's clean verdict now binds to the bytes it was computed from.** The presigned PUT that
  delivers an upload stays valid for the rest of its lifetime, so the same URL could overwrite the
  object minutes after ingest had already committed the version clean — and the overwrite's own R2
  object-create event no-opped, because the only branch that ran for a non-pending version looked at
  the scan engine's version and never at the bytes. The swapped content was then served to every firm
  member under `scan_verdict = 'clean'` with a hash that described content that no longer existed.
  An object-create event for an already-committed version is now treated as what it is — a second
  write — and the stored bytes are re-measured against the hash recorded at commit. Matching bytes
  leave the verdict standing (an at-least-once redelivery changes nothing); differing bytes withdraw
  the version behind the status gate, scan the replacement content so the row records what arrived,
  repoint the file's current version at the newest version that is still clean, and emit the ordinary
  quarantine audit/outbox/telemetry trio. A scan that cannot run is never a reason to leave swapped
  bytes servable — the withdrawal happens either way.
- **Legacy Office documents are no longer quarantined for telling the truth.** The ingest gate
  compared the sniffed content type to the declared one with byte-exact string equality, but a
  magic-byte sniff names the container: every pre-2007 Word, Excel, PowerPoint and Outlook file sniffs
  as `application/x-cfb`, while a browser declares `application/msword` and friends from the
  extension. Each one was read as a lie and quarantined — and the sniffed container type was missing
  from the default upload policy's allowed list too, so nothing could have let it through. The
  comparison now normalizes case and parameters and consults an explicit table of container
  relationships (the compound-file family; ZIP against the OOXML/OpenDocument formats, in both
  directions, since the sniffer reports the bare archive when its markers fall outside the head
  window). Every pair outside that table still disagrees and still quarantines.
- **A gate quarantine records why it happened.** A version rejected for a type lie, a size lie or a
  policy breach persisted a null `scan_detail`, so the reason reached only the outbox message and the
  telemetry event; a reviewer opening the row later could not tell a malware hit from a size mismatch.
  The reason is now written to the row.
- **`firm.bucket_name` is UNIQUE.** The ingest consumer resolves an R2 event's bucket name back to a
  firm with `WHERE bucket_name = ?`, and the provisioner's comments already described the stored name
  as per-firm unique, but nothing enforced it — two firms sharing a name would have made that lookup
  ambiguous. Added as a control-plane migration; SQLite treats NULLs as distinct, so firms whose
  bucket is not yet provisioned are unaffected.
