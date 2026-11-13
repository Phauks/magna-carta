---
category: Changed
audience: internal
---

**No signer's record on the Certificate of Completion runs across two pages.** The signer details are laid out two signers to a page and the audit log twenty rows to a page (`SIGNERS_PER_PAGE` and `EVENTS_PER_PAGE` in `packages/signing/src/certificate-sheet.ts`), and every page of a section that runs past one carries its heading and its place, as `Signer Details (1 of 3)`. The two Contact lines are labelled `Document` and `Certificate of Completion`. The document hash prints as two lines of 32 characters, each in groups of six. The audit log gives the name and the address columns more of the width, so an IPv4 address no longer wraps.
