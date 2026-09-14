---
category: Fixed
audience: public
---

**Report an Issue from the Build Information panel now stays open, and the panel links the
repository its commits belong to.**

**A dialog cannot be a child of the surface that dismisses it.** The panel mounted the issue
reporter inside itself, and the panel is the body of the chip's popover: pressing Report an Issue
closed the popover (correctly — a popover cannot be read from under a modal) and the popover's exit
then unmounted the dialog it had just rendered, about a second after it appeared. Both surfaces went
at once, which read as the report refusing to open. The flag and the diagnosis it carries now live
in `$lib/components/issue-report.svelte.ts` and the shell mounts the one dialog — the same move
`build-panel.svelte.ts` makes for the panel's own open flag, and for the same reason.

**One dialog, one draft.** The profile menu and the command palette each mounted a copy of the
reporter too. Those two worked, because a menu that closes does not own the dialog's DOM, but three
mounts meant three drafts: a half-written report begun from the palette was invisible from the
profile menu, and the other door opened on an empty field. All three doors now open the shell's one
dialog and contribute nothing but the gesture.

**The panel links its own source.** `repositoryUrl()` joins the commit and dashboard links in
`$lib/versions/deployment-links.ts`, and the panel's header carries it at the end of the control
cluster so the three controls beside it keep their seats. It is `BUILD_IDENTITY.sourceRepository` —
resolved at build time from the git remote, the same value every commit link is already built on —
so a build that resolved none renders no link rather than a dead one, and it is signed-in only by
the same rule the commit and Worker links keep.

## Public

Reporting a problem from the version chip works again. The report used to appear for a moment and
then vanish along with the panel behind it; it now stays open, with everything the panel was
showing already attached.

A half-written report also survives being closed and reopened from anywhere — the profile menu, the
command menu and the version chip now open the same report rather than three separate ones.

For the people who run the platform, the version overlay carries one more link at the top: the
source the build on screen came from.
