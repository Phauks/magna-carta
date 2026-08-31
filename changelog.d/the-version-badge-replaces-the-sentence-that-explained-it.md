---
category: Changed
audience: public
---

**The Build Versions panel reads the pair that serves you at a glance, and stops resizing itself
while you watch.** The fixed sentence explaining that `magna-carta-web` and `magna-carta` deploy
separately and may report different builds is gone. In its place, the leading pair carries a
colour-coded badge: green **In sync** once they match, amber **Web behind** when the web build is
the one that has fallen behind (the one case actually worth reloading for), or a calm **Different
builds** for any other gap — shown only once both sides have a real version to compare. Separately,
the "Checking services" / "Services checked … ago" line under the header no longer appears and
disappears as a read moves from in flight to freshly answered to aged; it now holds its place at a
constant height, so the panel's size never depends on which sentence happens to be showing.

## Public

**The version panel now colours the API and the page it serves instead of explaining them in a
sentence, and it stops jumping around while it loads.** Open the chip in the top corner: the two
workers that serve your session carry a small badge — green when they match, amber when the page is
the one running behind, and a plain grey label for any other difference, since the two are allowed
to deploy at different times. The "checking" line under the panel's title also no longer causes the
panel to grow or shrink as it fills in.
