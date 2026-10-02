---
number: 422
slug: the-shell-learns-what-fifteen-callers-repeated
status: Accepted
date: 2026-09-02
area: Design system
summary: "With fifteen panels on ActionDialog, what they still repeated was measured and four findings became shell or design-system changes. The primary pane is a real form and the commit is its submit button by id, so Enter commits everywhere and a disabled commit stops it, with Ctrl+Enter or Cmd+Enter from a textarea; none of the fifteen had wired Enter because each would have had to. subtitle takes a string, since twelve of fourteen were plain text. The maturity vocabulary — model, badge, dot and the Soon affordance — moves from the app into the design system as one home, and the shell gains commitSoon so an act not served yet renders in a panel exactly as it does in a menu; the two panels that composed the affordance around their own commit lose their reason for an allowance. LabelledField and FieldRow are the layout every plain form rebuilt: the field mints its id, joins hint and error into the control's description and marks an error invalid, handing the control its attributes to spread in formsnap's idiom; it is deliberately not the superforms-bound Form.Field, and the two recipes' differing gaps are stated rather than reconciled. Refused, again: a third control in the action bar."
---

**A shell earns its next seam by measurement, not by request, and the measure was fifteen callers.**

**Context:** Fifteen panels had migrated onto `ActionDialog`. The shell was built domain-blind and
with a closed set of seams, on the argument that a seam added on a hypothetical is a seam every
panel then pays for. That argument holds only if the seams are revisited once there is evidence, so
the fifteen were read for what they still wrote by hand.

Four things repeated. No caller had wired Enter, because the pane was a `div` and each panel would
have had to wire it alone; a reader in a text field pressed Enter and nothing happened, in every
panel. Fourteen of fifteen subtitles were snippets, and twelve of those were plain text wrapped in
three lines of snippet syntax. The label-over-control column appeared fifty-six times and the
two-across row sixteen, minting ids by hand on both sides of the label, and about a third of the
hints beneath a control were not its accessible description. And two panels — one migrated, one
still allowanced — composed `SoonAffordance` around their commit, because the affordance lived in
the app and a design-system shell cannot import the app.

**Decision:**

_Enter commits, from the shell._ The primary pane is a `<form>` and the commit in the bar is its
submit button by `form` attribute. That makes the platform's implicit submission do the work: Enter
in a field presses the commit, and only while the commit is enabled — so a refusal, or an act not
served yet, refuses Enter for nothing. Ctrl+Enter or Cmd+Enter commits from a textarea, the one
field where Enter must keep meaning a new line. The form is `novalidate`: a refusal is the shell's,
stated beside the commit and read to a screen reader from it, never a browser bubble over a field.

_`subtitle` takes a string or a snippet._ The common case is one line of text and reads as one
attribute; the snippet arm stays for markup.

_The maturity family moves into the design system, and the shell gains `commitSoon`._ The model,
the badge, the dot and the Soon affordance are `@magna-carta/design-system/maturity`, one home,
with their tests moved alongside; `SoonAffordance` is registered in the one-implementation
registry. The acting arm of the shell's props gains `commitSoon: { reason }`, and the shell wraps
its own commit in the affordance — disabled, badged, the dependency as its accessible description.
The bar still holds exactly one commit in the shell's source: the control is one snippet rendered
one of two ways, so the `footer-set` rule stays true without being loosened.

_`LabelledField` and `FieldRow`._ The field mints the control's id unless told one, joins the hint
and the error into one `aria-describedby`, marks an error `aria-invalid`, and hands the control its
attributes as `props` to spread — the idiom formsnap's `Control` already uses, so the association
cannot be mis-wired. It is deliberately not the form family's `Field`, which is bound to superforms
and exists for a schema-validated form; a panel's fields live in its own state and are refused on
the commit. The two stack the same parts at different gaps — space-8 here, which is what every
migrated panel had and the owner has reviewed on screen; space-4 there — and that is recorded on
the recipe for the owner to settle rather than silently made uniform. `FieldRow` is utilities
only, because a breakpoint is the one thing the recipe layer cannot express.

_Refused: a third control in the action bar._ Two of the remaining panels carry Close, Copy and
Send. The copy belongs in the body beside the text it copies, as the reading kind seats its step;
the bar stays two controls, and the rule that asserts it is unchanged.

**Consequences:** Every panel on the shell gained Enter without a line of change, and the two
panels waiting on an unserved act can migrate as plain forms with `commitSoon`. The fifteen
migrated panels adopt `LabelledField` and `FieldRow` in the pass that continues the migration, so
the shape lands once rather than being rewritten per panel again. Thirty-five app files changed
their import path for the maturity family and nothing else. Two divergences are now stated where
they can be found — the two field gaps, and the two hint colours the form family and the panels
use — instead of being discovered by eye.
