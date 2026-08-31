---
category: Changed
audience: internal
---

`GET /api/v1/firm-usage` now composes the three AI meters that were written but read by no route
(`token_usage_meter`, `ai_search_usage_meter`, `ai_detection_usage`), plus new per-domain reads:
matters by type and by location (`@magna-carta/matters/queries`), the file versioning breakdown with
sizes (`@magna-carta/file-manager/usage`), location rows with staffing counts
(`@magna-carta/locations/statements`), Directory people/organization counts
(`@magna-carta/directory/usage`), and the active member count. Everything is computed on the
request — no cache, no snapshot — so a page nobody opens costs nothing. The roadmap's claim that the
token meter feeds the firm-usage surface, which had drifted ahead of the code, is now true.
