---
category: Added
---

**Email files can now be inspected.** A `.eml` or `.msg` (Outlook) file dropped into the new **Email Inspector** tool is read into a structured report — sender and recipients, subject and dates, the full ordered header list, the attachment list, and the authenticity evidence a message carries (its DKIM signature, authentication results, and delivery chain), all shown verbatim with no verdict attached. Nothing is stored; the file is parsed and the report returned.

Underneath sits a new pure-Rust parse engine that reads all three formats, extracts each attachment on demand rather than holding a whole mailbox's attachments in memory at once, and is hardened against malformed input — it runs where a crash would take down the whole request handler, so every structural fault in a hostile file becomes an ordinary error instead. It is the foundation the coming email-into-matters capture and discovery features are built on, and it is deliberately honest about what it does not yet do: turning an email into a PDF remains a separate future step.
