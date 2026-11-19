---
category: Changed
audience: public
---

**Trust check printing opens the PDF first and records after.** The Confirm Print dialog is
removed. Print composes the PDF in the browser from the To Print rows and the stock with the
numbers the screen shows, without calling the server; the button then reads Mark N Printed, which
sends the batch to the print route with `firstCheckNumber`. Changing the selection or the number
drops back to Print. The developer gallery's state and panel buttons are removed.

## Public

**Printing trust checks: the PDF opens straight away.** Print Checks opens the checks to print
with no window in between. When they are out of the printer, press Mark Printed to record them, or
Cancel if you did not print them.
