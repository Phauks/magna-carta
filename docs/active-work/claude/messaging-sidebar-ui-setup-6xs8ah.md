---
worktree: C:/dev/magna-carta-worktrees/claude/messaging-sidebar-ui-setup-6xs8ah
area: Messaging — the sidebar destination settled as the firm's call and text log, its design spec, and the registry corrections that follow
status: designing
touches: apps/web/src/lib/navigation/destinations.ts, apps/web/src/lib/matters/sections.ts, docs/specs, roadmap.d/communications.md, roadmap.d/portal.md
---

The sidebar's Messaging row had three different scopes attached to it — an id meaning the whole
Communications layer, a label meaning one channel, and a description meaning two — and the matter
section under the same name described portal messages, which is a fourth thing. The owner settled it
on 2026-09-07: Messaging is **calls and texts**, logged against the matter and the contact, routed
through the carrier so the logging is automatic, with recording and transcription on top. Email is
deliberately not in this row. This stream writes the design spec for that surface and corrects the
two registries that describe it, so nothing else in the tree has to guess what the word means. It
edits the destination registry and the matter section registry — a concurrent stream touching either
should say so before this one lands.
