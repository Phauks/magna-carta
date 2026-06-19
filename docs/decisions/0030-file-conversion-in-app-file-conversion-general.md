---
number: 30
slug: file-conversion-in-app-file-conversion-general
status: Accepted
date:
area: File conversion
---

**In-app file conversion:** general any-format→any-format utility in the file manager, **in-house** for confidentiality (R2 → own Container → R2, no third-party egress) + margin + integration. A unified **conversion orchestrator** over a data-driven **format registry** (with multi-hop chains) dispatches to engines already run — LibreOffice, libvips, discovery OCR, FFmpeg — plus a small email→PDF worker. **Hybrid** execution (small inline, large/batch as a per-job Durable Object with progress + completion notification); output is the **user's choice** — versioned save-to-matter or download, single or batch. Third-party converters (CloudConvert/Zamzar) and bundling an all-in-one OSS converter (Stirling-PDF/ConvertX) rejected — redundant with engines already running, plus egress/attack-surface.
