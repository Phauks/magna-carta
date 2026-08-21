---
category: Fixed
audience: public
---

**Three corrections on the signed-out surface.** The sign-in card's footer line is gone. The quiet
inline links beside a field — Register, Forgot Password, and every other side door sharing the
`QUIET_LINK` register — now carry `cursor-pointer`: they render as bare `<button>` elements to stay
out of the control chrome, and Tailwind v4's preflight sets `cursor: default` on a button, which the
design system's own Button recipe answers for itself but a raw-class link does not. And the chrome
band's four destinations now resolve through `ECOSYSTEM_SITES` instead of a local list of hardcoded
`#` hrefs, so Status links to the live status page and the three sites that are not stood up yet stay
inert until their registry entry carries a URL.

The band having its own copy of each address is what let the status page be live and unreachable from
here at the same time.

## Public

**The Status link in the top bar works.** It opens the live service-status page. The sign-in screen
also drops a line of boilerplate under the card, and the small links beside each field now show the
hand cursor when you hover them.
