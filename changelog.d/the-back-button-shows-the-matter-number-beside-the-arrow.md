---
category: Fixed
audience: public
---

**The back button on the editor's bar shows the matter's number beside the arrow.** The editor's shortcuts bar draws no words for any button (its builder switches labels off and keeps a button's text as its `data-cooltip` tooltip), so the number the host sent as the label was a tooltip and nothing more. The stylesheet the edit worker serves now draws the words from that attribute in a `::after` rule on the host button, cut to `BACK_LABEL_CHARACTERS` (12) with an ellipsis; the editor's own tooltip shows the whole number on hover.

## Public

**The way back from a document now shows the matter's number beside the arrow**, cut short with an ellipsis when it is long. Rest the pointer on the button to see the whole number.
