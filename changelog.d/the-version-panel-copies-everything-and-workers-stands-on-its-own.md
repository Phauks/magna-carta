---
category: Changed
audience: internal
---

The version panel copies the whole diagnosis, from a control at the top, and Workers is a section rather than a drawer.

Copy sat at the FOOT of the Database section and put four health rows on the clipboard. A member reporting a fault therefore pasted the database's state and nothing about which build was serving it — the one fact that says whether a fix has even shipped yet — and copying part of the diagnosis reads exactly like copying all of it. The control is now at the top, where a reader reaches for it before scrolling past everything they wanted copied, and it takes the whole panel: this page's build, the API, every Worker the read named, and the database line. Multi-line, because a dozen facts on one line is a paste people summarize from memory instead. A Worker that reported nothing says so rather than going missing, since "absent from the paste" and "reported nothing" are different faults.

Workers has left Deployment and become a caret of its own, beside Deployment and Database. Nesting it made the fleet something a reader reached THROUGH the deployment, when in practice the two are asked about separately: "what build is live" and "is anything not answering" are different questions, and one of them was two folds deep. Each shut heading now counts only the Workers its own fold hides — one count across the whole read would have both headings claiming the same silent Worker.

Three source assertions that pinned the old shape were rewritten to the rules they were actually guarding, rather than to the layout that happened to satisfy them: section order is asserted over the markup instead of the whole file, and the refresh rule is that every gesture a person makes probes fresh rather than that there are exactly two such gestures. One of them required a hand-written `aria-busy` on the refresh control, which the later ruling that every loading state runs through one region forbids outright — the two rules contradicted each other, and the test was the older one.
