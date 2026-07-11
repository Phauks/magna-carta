---
category: Added
---

**Outlook messages whose only body is rich text now show that body.** A `.msg` file often stores its body as compressed RTF; the Email Inspector previously showed nothing for such a message. That body is now decompressed and surfaced. It is shown as-is, not converted or rendered, and a corrupt or oversized body is skipped rather than failing the whole message.
