---
worktree: /home/user/magna-carta
area: Calendar — the owner's round of 2026-09-18 on the event form, the time zone display, the pickers and the time grids
status: review
touches: apps/web/src/lib/calendar, apps/web/src/lib/time/matter-picker.svelte, apps/web/src/lib/matters/member-picker.svelte, apps/web/src/lib/file-manager/upload-dialog.svelte, packages/design-system/src/lib/formatters, packages/design-system/src/lib/components/calendar-grid, packages/design-system/src/lib/components/action-dialog, packages/design-system/src/lib/internal/discard-question.svelte, packages/design-system/CLAUDE.md, docs/conventions/design-corrections.md, docs/user/features, changelog.d
---

The owner's round on the calendar's event form and the grids it paints on. The form's left side is
four tabs; its first line offers a matter, the firm, or a staff member, and the field beside it
keeps one slot so the choice no longer reflows the form. All Day is a switch; a run of days is drawn
in the all-day band rather than as full columns on the hour axis (which also fixes the blocks that
reached past the working hours, and the pieces whose ids no press could open). A zone reads as one
line everywhere through a new `formatTimeZone` / `describeTimeZone` in the design system's display
vocabulary, and an hour on a chip carries its code on its day. Location offers offices with their
addresses and the directory's organizations. Participants are bundled under Staff, Directory and
Other. The day pane carries the rail's selection as a Calendars menu. Every picker that clears
itself through a row refuses the combobox primitive's deselect-on-re-pick, which is what emptied
the matter field. The action dialog's discard question loses its sentence.

`docs/conventions/design-corrections.md` and `packages/design-system/CLAUDE.md` are the two
cross-cutting files this stream touches, each with a few lines under the calendar's own entries.
