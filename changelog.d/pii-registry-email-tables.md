---
category: Fixed
---

- **The email-filing tables are now classified in the PII/erasure registry.** The six per-firm tables
  the email filing record model added (`email_thread`, `email_message`, `email_matter_link`,
  `email_participant`, `email_attachment`, `email_capture_address`) landed unclassified, so the
  registry's coverage fitness function was red on `main`. `email_message` (frozen sender address),
  `email_participant` (each frozen from/to/cc/bcc address, plus its resolved Directory entity where one
  exists), and `email_matter_link` (which firm member filed a message to a matter) are registered as
  personal data retained under the matter corpus; `email_thread`, `email_attachment`, and
  `email_capture_address` are recorded as explicitly non-PII structure. Participants are keyed by
  frozen address value as well as by resolved entity id, so a participant the Directory never matched
  is still reachable by erasure.
