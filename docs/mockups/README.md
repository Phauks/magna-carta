# Mockups — the owner's original design surfaces

These files are the **source** the application screens are ported from. They are not reference
material and not inspiration: each one was authored by the owner and revised across many rounds of
review, and where a screen in `apps/web` or a component in `packages/design-system` differs from the
mockup, the mockup is the thing that was decided and the code is the thing that has drifted.

## Why they live here

They existed only as published artifacts — nowhere on disk, nowhere in git. Recovering them meant
finding them in an artifact listing, which is one accident away from not finding them at all. They
are committed here so that the design record never again depends on a service listing.

## They are frozen

Nobody edits these files to reflect what the application currently does. When the app and a mockup
disagree, that disagreement is **a finding about the app**, to be raised and resolved in the app. A
mockup quietly edited to match the code stops being evidence of anything — it becomes a second copy
of the bug.

Corrections to the design itself come from the owner, not from a porting pass.

## Reading the files

Each file opens with a block of runtime script injected by the artifact host — a `<base>` tag, a
`__FRAME_PREAMBLE` object, and one long minified bootstrap. That wrapper is not part of the design
and carries no meaning here. **The design begins at the `<title>` tag** and runs to the end of the
document: everything after it is hand-written HTML, CSS, and JavaScript.

## Read alongside the rulings

The review rounds these mockups went through produced a written record of what the owner *ruled*:

- [`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md)
- [`docs/conventions/time-tab-rulings.md`](../conventions/time-tab-rulings.md)

Those rulings were issued **against these surfaces**, so the two are read together — the ruling says
what was decided, the mockup shows what it was decided about. Neither is complete on its own.
