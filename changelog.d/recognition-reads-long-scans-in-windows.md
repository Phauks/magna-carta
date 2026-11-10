---
category: Fixed
audience: public
---

**A scanned PDF of more than 100 pages is recognized instead of refused.** `recognize_pdf` (`containers/ocr/src/lib.rs`) rejected any document over `MAX_PAGES` whole, so a 101-page scan lost its first hundred pages along with the rest. `POST /ocr` now takes `?firstPage=N` and walks one window of at most `MAX_PAGES` pages from that index, and its response carries `pageCount`. A request that names no window is still refused for a long document, because answering it with the first window would hand that caller a truncated reading it cannot notice. `recognizedPages` (`apps/api-worker/src/search/text-extraction.ts`) asks for each window in turn, placing every window at the next page that needs recognition, so a long born-digital filing with one scanned exhibit is one request. It stops at 500 windows (50,000 pages) with `limitExceeded`. `forwardOcr` (`apps/ocr-worker/src/forward.ts`) dropped the query string, which also meant `force=true` never reached the engine; it carries it through now. `pageCount` is optional in the Worker's schema, so a Worker deployed ahead of the container reads the old response as a single window. Each window re-sends the document and runs in sequence, so a very long scan is bounded by the queue consumer's wall clock; `POST /ocr/searchable` and the `/api/v1/ocr` route still take one window's worth.

## Public

**Long scanned documents are now searchable.** A scanned PDF of more than 100 pages used to be skipped entirely, so none of its pages could be found by search. It is now read from the first page to the last, up to 50,000 pages.
