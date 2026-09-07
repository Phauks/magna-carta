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

The tray has TWO ENDS, which is how it tells its two kinds of thing apart without a divider: the
rail's own controls lead — Settings, then Customize — and the registers lean to the inline end on an
auto margin. Settings leads the row outright because the collapsed rail shows the tray's first icon
and hides the rest; the trailing pair is one element, so that rule takes it away and brings it back
whole. Which end each fixture belongs to is stated in the shell rather than derived, because it is a
fact about the tray and not about the registry, which orders by where a destination sits in the app.

`.mc-sidebar-controls-trailing` carries the auto margin rather than the tray carrying
`justify-content: space-between`, which would also have spread Settings and Customize apart from
each other — the same reason the choice row's trailing part uses one.

The top-bar trays are unchanged, and the two levels are deliberately distinct: the tray beside the
timer is a summary with quick actions, the footer icon opens the full surface.

## Public

**Downloads and Uploads moved to the bottom of the sidebar.**

Both are about what the application is doing rather than about a matter, and they often run at the
same time, so they now sit in the row at the foot of the sidebar: Settings and the Customize control
at its near end, Downloads and Uploads at its far end. Uploads no longer has to be added from
Customize to reach it, and neither can be hidden by accident.

The download and upload buttons in the top bar are unchanged. Those stay what they were — a quick
look at what has just happened, with the acts you usually want — and the icons at the foot of the
sidebar open the full pages behind them.
