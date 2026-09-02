---
category: Changed
audience: public
---

**Enter commits in every `ActionDialog`.** The primary pane is a `<form>` and the commit in the bar is its submit button by `form` attribute, so the platform's implicit submission does the work and a disabled commit stops it; Ctrl+Enter or Cmd+Enter commits from a textarea via the form's keydown listener. No caller changed.

## Public

**Press Enter to finish what a panel asks.** Pressing Enter in a panel's field now does what the panel's button does: writes off the balance, records the delivery, opens the packet. In a multi-line field, where Enter starts a new line, Ctrl+Enter (Cmd+Enter on a Mac) does the same. A button that cannot be pressed still cannot be pressed from the keyboard.
