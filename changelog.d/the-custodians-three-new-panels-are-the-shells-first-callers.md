---
category: Changed
audience: internal
---

The custodian's three panels — logging a packet, describing an item, filing a copy — are the first screens to open in `ActionDialog`.

They landed the same week the shell did, each carrying the scaffold by hand: its own open flag, its own busy flag, its own footer, and no guard on the way out. `lint:one-ui` caught all three the moment the two branches met, which is what the rule is for. They are migrated rather than allowanced: an allowance records debt that predates a rule, and these postdate it.

Being real callers changed the shell twice, which is what first adopters are for. A commit now takes a second word for the same verb — "Logging" beside "Log Packet" — because thirteen panels across the product already changed their label in flight and losing that would have been a visible regression. And the reason a commit is refused is now **rendered** at the weak end of the action bar rather than only hovered: a `title` is not discoverable by anyone who is not already hunting for it, and the reader who most needs it is the one looking at a control that will not press.

All three gain the guard they never had: Escape, the corner dismiss and a press outside now ask before throwing away a half-described will.
