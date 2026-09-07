---
category: Changed
audience: public
---

**Downloads and Uploads left the Workspace group for the sidebar's footer utility tray.** The
owner's ruling of 2026-09-07: the two transfer registers describe what the application is doing —
often both at once, since a download and an upload can run together — rather than naming a place in
the firm's work, so they belong beside Settings and Customize at the rail's foot and not among the
destination rows.

The mechanism is the registry's existing `footerPinned` tier, which until now held Settings alone:
`sidebarGroups()` and `sidebarEditingGroups()` already skip it, so marking the two entries takes
them out of the scrolling groups AND out of Customize mode in one move, with each row keeping
exactly one home. Both are `pinned` as well, so they are fixtures rather than stars — there is
nowhere else for them to be, and nothing to hide them from. A member who had arranged or unstarred
either one keeps a stale id in stored preferences, which `mergeGroupOrder` has always filtered
against the visible set, so no migration was needed.

The shell renders the tray from the registry rather than hand-listing icons, but states the ORDER
itself — Settings, Downloads, Uploads, then Customize — because Settings must lead: the collapsed
rail shows the tray's first icon and hides the rest, and the registry orders by where a destination
sits in the app, not by which icon survives a collapse.

The top-bar trays are unchanged, and the two levels are deliberately distinct: the tray beside the
timer is a summary with quick actions, the footer icon opens the full surface.

## Public

**Downloads and Uploads moved to the bottom of the sidebar, beside Settings.**

Both are about what the application is doing rather than about a matter, and they often run at the
same time, so they now sit together with Settings and the Customize control at the foot of the
sidebar. Uploads no longer has to be added from Customize to reach it, and neither can be hidden by
accident.

The download and upload buttons in the top bar are unchanged. Those stay what they were — a quick
look at what has just happened, with the acts you usually want — and the icons at the foot of the
sidebar open the full pages behind them.
