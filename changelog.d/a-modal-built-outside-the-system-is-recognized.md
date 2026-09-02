---
category: Added
audience: internal
---

`lint:one-ui` now recognizes a modal panel built outside the shells.

The expensive shape was never the crude one. A raw `<dialog>` and a scrim in a `<style>` block were already caught; what passed every gate was a screen importing the design system's own `Dialog.Root` and `Dialog.Content` and composing a panel by hand. It renders correctly, it typechecks, it lints, and it reads fine in review — it simply does not share the answers the shells settle.

Three source signals, because a modal built outside the system arrives as any of them: a composed `Dialog`/`AlertDialog`/`Sheet` panel outside a declared shell's home, a scrim written as utilities (`fixed inset-0` at the modal layer, which the style-block rule cannot see and which is the shape this repository actually writes), and a reach for the platform's own modal. Both shells also stamp `data-modal-shell` on the panel they render, which is the half that reads behaviour rather than source — a marker a rendered-DOM check can require of anything carrying the `dialog` or `alertdialog` role, and the only thing that catches a panel whose parts were aliased on import or chosen at runtime.

Which homes may compose a panel is **declared**, in `registry.json` beside the component register, rather than listed inside the rule — so adding a shell is a reviewed edit to the file that already answers "what is in the system". Being a registered component is deliberately not enough on its own: `RecordAttachments` is registered and still holds a confirmation that should be an `ActionDialog`, so it carries an allowance rather than an exemption.

A second rule, `footer-set`, asserts the action bar the way the header set has always been asserted against the record window: exactly the dismissal then the commit, in that order. A reader who has learned where the commit sits has learned it in every panel in the product, and a third control would un-learn that everywhere in one edit.

The thirty-seven panels that predate all this are carried as printed allowances with a reason each. They are debt, not exemptions: an allowance that outlives its violation is itself a failure, so the list can only shrink.
