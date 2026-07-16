---
category: Added
---

**Convert a scanned PDF into a searchable one through the file converter.** The conversion registry
now has a `pdf → searchable-pdf` edge served by the OCR engine: submit a scanned PDF as a conversion job
and get back the same document with an invisible, selectable text layer over every scanned page (a page
that already has text is left untouched). Because the converter composes multi-hop paths, a scanned
image reaches a searchable PDF too — wrapped into a PDF and then recognized — once the image-to-PDF
engine is deployed. The OCR engine runs as its own already-live service, so this hop works today without
waiting on the dedicated conversion worker; the job coordinator, queue, and polling are the same ones
every conversion uses.
