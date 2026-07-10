---
category: Added
---

**A way back from a tool page to the listing.** A tool sub-page (for example the network speed test) now shows a subtle back affordance at the top of the canvas — a leading arrow and the destination name "Tools" — so returning to the tools directory no longer means the browser back button or hunting the sidebar. A new `tools` route layout renders it above every tool page and suppresses it on the `/tools` listing itself, so present and future tools inherit the affordance for free. The affordance is a reusable `BackLink` (design-system Button in its ghost register, rendered as an anchor) inside a `Breadcrumb` navigation landmark, with an accessible name ("Back to Tools") that reads unambiguously out of context beside a page masthead.
