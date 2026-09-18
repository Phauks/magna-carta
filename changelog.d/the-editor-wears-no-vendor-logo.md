---
category: Changed
audience: public
---

**The editor's corner no longer carries its vendor's logo.**

The editor hides its logo when a hidden field on its page reads `none`, and the community build of the image leaves that field empty with no setting to fill it. The worker in front of the container now fills it, rewriting that one attribute as the page streams through; nothing is injected, because the page's own policy allows no inline style or script, and an upgrade is handed back untouched as before.

## Public

The document editor shows the document and its own tools, and no logo in the corner.
