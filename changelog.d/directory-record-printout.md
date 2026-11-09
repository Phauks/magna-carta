---
category: Added
audience: public
---

**A directory record downloads as a PDF or plain text, beside the contact card.** The entity window's More menu now has a Download submenu (PDF, Plain Text, Contact Card). `record-printout.ts` reads every page of the record's names, contact points, relationships and matters and lays them out as a `TabularExportDocument`, so the PDF comes from the reports' server renderer (`renderRemoteExport`, which needs `reports:export`) and the text from `renderTextExport`. Sealed identifiers are never printed.

## Public

**A Directory record can be downloaded as a PDF or a text file.** The More menu on a person's or organization's record now has a Download option with three formats: PDF, Plain Text, and Contact Card (.vcf). The PDF and text file are a printout of the record, including its names, dates, contact details, addresses, relationships and matters. Contact details the person asked the firm not to use are marked. Sealed identifiers such as a social security number never appear in the printout.
