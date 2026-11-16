# Printing trust checks

_In daily use once your account's check stock is set up._

## What it does

When a payment out of a trust account is recorded as paid by **check** and no check number is
typed in, it waits on the account's **Checks** screen to be printed. Printing numbers each check
from the account's next number, and you get a PDF to send to the printer loaded with your check
paper. Afterwards you say which checks came out right. A check that jammed or printed crooked is
voided with its number kept, and the payment goes back to the list for a new check.

Open it from **Trust**: pick the account, then **Open Checks** under **Checks** on its record.

## Setting up your check stock

Check paper differs from bank to bank, so each account has its own **check stock**: where the
date, payee, amount, amount in words and memo print on your paper.

1. Open **Check Stock** on the Checks screen. If you press **Print** before an account has check
   stock, you are taken there first.
2. Pick the page layout your paper uses: the check on top with two stubs below, the check in the
   middle, the check at the bottom, or three checks to a page.
3. Every field starts at the spot most business checks use. To see exactly where they will land,
   **Add Scan** (or **Replace Scan**): take a photograph or scan of one blank check, drag its four
   corners onto the corners of the paper, and choose **Use This Scan**. It is straightened and
   shown behind the fields with **Scan Behind**; **Fields Only** and **Sample Check** show the
   fields over nothing or over a plain drawn check. The scan is only ever shown on screen; it never
   prints. **Start From Standard Positions** puts every field back where it began.
4. Drag a field to move it, or drag the handle at its right edge to size it. Arrow keys move the
   selected field a hundredth of an inch; hold Shift for a tenth. The panel beside the check shows
   the selected field's **From Left**, **From Top**, **Width** and **Text Size**, and you can type
   them too. A field shown in red cannot print where it is. **Add Field** adds the matter or a
   check number for blank stock; the date, payee, amount and amount in words can be moved but not
   removed.
5. Enter the **Starting Check Number**: the number printed on the first sheet of the box. A number
   below one already used is ignored, so a number is never used twice.
6. **Print Test on Plain Paper**, hold the sheet over a blank check against the light, and adjust.
   If every field is off by the same amount, change the **Whole Page** shift instead of moving each
   field.
7. **Save Layout**. Nothing is kept until you do.

The bottom strip of a check, where the bank's routing and account numbers are printed in magnetic
ink, is marked on screen. Nothing may be placed there: ink in that strip makes the bank's machines
reject the check.

## Printing

Every payment waiting on **To Print** starts ticked. Untick any you are not printing; each ticked
row shows the number it will print on. Press **Print N Checks**. The checks are numbered in the
order shown and a PDF opens in a new tab; print it from there (if your browser blocked the tab,
use **Open PDF** in the panel that follows). Then, in **Record How N Checks Printed**, mark each
check **Printed**, or **Spoiled** if it jammed or came out wrong, and press **Record Results**. A
spoiled check keeps its number on the **Voided** list, and the payment returns to **To Print** for a
new number.

If you press **Cancel** instead, the checks stay numbered as **Not Answered** on the **Printed**
list, and **Answer** asks again.

## Voiding a check

A check that was lost, went stale or was stopped can be voided from the **Printed** list: open the
**...** menu on its row and choose **Void**, then give a reason and press **Void Check**. Its number stays on the record and the payment returns to **To Print** so you can issue a
replacement.

Voiding a check does **not** cancel the payment. The money left the client's ledger when the
payment was approved. If the payment itself should not happen, record a deposit back to the
client's ledger as well.

A sheet torn in the printer before it was printed can be voided with **Void Next Number** in the screen's **...** menu, so the
numbers on screen keep matching the paper.

## A check you wrote by hand

If you record a payment by check and type the check number yourself, it is never put in the print
list. Its number is still what the bank statement is matched against during reconciliation.

## Who can do what

Anyone who can see the firm's trust accounts can see the checks. Printing, answering, voiding and
setting up check stock need the trust management right. Printing a check moves no money, so it does
not need a second person.
