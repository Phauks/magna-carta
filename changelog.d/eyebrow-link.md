---
category: Added
---

**A new `EyebrowLink` design-system component** — a masthead eyebrow that navigates: the subtle letterspaced small-caps kicker rendered as an anchor, with a consumer-supplied leading icon and label. Unlike a button repurposed as a link it is a label, not a control, so it carries no control height — the ink sits flush with the block-start edge of its box, and a page frame's equal padding reads symmetrically (a leading arrow lands the same distance from the frame's top as from its start). The 24x24 pointer target (WCAG 2.5.8) comes from a transparent overlay that enlarges the hit area without enlarging the box. The Tools page's back-link now composes it, retiring the inline letter-spacing and negative-margin workarounds it needed while built on the button.
