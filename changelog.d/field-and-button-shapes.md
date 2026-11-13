---
category: Changed
audience: public
---

**Fields, choices and buttons get a visible edge, a hover, one focus ring and a distinct disabled look.** New semantic tokens `border.field`, `border.field-hover`, `border.control` and `surface.field-disabled` (light and dark, held by the contrast gate at 3 to 1 for the edges) feed the Input, Textarea, Select, Combobox, date, date-time, Checkbox and Radio recipes: the edge darkens on hover, focus is the ink edge with the accent ring, a disabled field is dashed on a pale fill, and Textarea, Select and the date field gain the danger edge for an invalid value. The secondary button is now outlined instead of a borderless grey fill, and every button's focus ring uses the accent.

## Public

**Forms are easier to read and fill in.** Every text box, dropdown and date field now has a clear outline, darkens slightly when you point at it, and shows a gold ring where you are typing. A field you cannot change has a dashed outline instead of looking like a button, and secondary buttons such as Cancel are outlined so the main action in a window stands out.
