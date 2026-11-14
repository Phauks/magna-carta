---
category: Changed
audience: public
---

**A tabular export's PDF is composed in the browser by the platform's PDF composer.** `apps/web/src/lib/export/render-pdf.ts` maps the export document onto `@magna-carta/pdf-compose` and composes it in a Web Worker; the export menu, the bulk download, the download tray, a conflicts report and a Directory printout all use it. `POST /api/v1/reports/exports` renders Word only and answers 422 to `pdf`; its office-suite conversion arm is removed. The composer joins the SPA's wasm build.

## Public

A report's PDF is now made on your own device, so it no longer waits on the document service and works even while that service is starting up. Wide reports print in landscape, and every page is numbered.
