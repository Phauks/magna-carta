# Printing trust checks

_In daily use once your account's check stock is set up._

## What it does

When a payment out of a trust account is recorded as paid by **check** and no check number is
typed in, it waits on the account's **Checks** screen to be printed. Before anything prints you
confirm the checks and the number on the first sheet in your printer, and you get a PDF to send to
the printer loaded with your check paper. Afterwards you say which checks printed right. A check
that jammed or printed crooked is recorded as misprinted: its number is voided and kept, and you
print the payment again on the next number in one step.

Open it from **Trust**: pick the account, then **Open Checks** under **Checks** on its record.

## Setting up your check stock

Check paper differs from bank to bank, so each account has its own **check stock**: where the
date, payee, amount, amount in words and memo print on your paper.

1. Open **Check Stock** on the Checks screen. If you press **Print** before an account has check
   stock, you are taken there first.
2. Pick the page layout your paper uses: the check on top with two stubs below, the check in the
   middle, the check at the bottom, or three checks to a page. Each choice shows a small picture of
   the whole letter page, and beside the choices the page you picked is drawn larger with sample
   values in every field and stub, exactly where they will print. It follows every change you make
   as you make it.
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
5. Enter the **Next Check Number**: the number printed on the next sheet of paper in your printer.
   It can be higher or lower than before. If that number is already used on the account, the next
   check prints on the first number after it that is not, so a number is never used twice.
6. **Print Test on Plain Paper**, hold the sheet over a blank check against the light, and adjust.
   If every field is off by the same amount, change the **Whole Page** shift instead of moving each
   field.
7. **Save Layout**. Nothing is kept until you do.

The bottom strip of a check, where the bank's routing and account numbers are printed in magnetic
ink, is marked on screen. Nothing may be placed there: ink in that strip makes the bank's machines
reject the check.

## Printing

Every payment waiting on **To Print** starts ticked. Untick any you are not printing; each ticked
row shows the number it will print on. Press **Print N Checks**.

**Print N Checks** opens a panel that lists the checks in the order they will come out, with the
check number, payee, amount and matter of each, and the **First Check Number**. Change the first
number if the paper in your printer starts somewhere else; the number beside every check follows
it. Load the checks it names in the printer, then press **Print Checks**. Nothing is numbered
until you do. If one of the numbers is already used on the account, the field turns red, the panel
says which number, and nothing is printed.

The checks are numbered and a PDF opens in a new tab; print it from there (if your browser blocked
the tab, use **Open PDF** in the panel that follows). Then, in **Record How N Checks Printed**, mark
each check **Printed Right**, or **Misprinted** if it jammed or came out wrong, and press **Record
Results**. A misprinted check keeps its number on the **Voided** list with the reason
**Misprinted**, and the print panel opens again at once for those payments, starting at the next
number, so printing them again is one step.

If you press **Cancel** instead, the checks stay numbered as **Not Answered** on the **Printed**
list, and **Answer** asks again.

## Changing the next check number

The check number is yours to set at any time. The Checks screen shows the account's **Next check
number** with **Change** beside it: type the number on the next sheet in your printer and press
**Save Number**. It can be higher or lower than before. If the number is already used on the
account, the panel says which number the next check will print on instead. You can also set the
first number of one batch in the print panel without changing the account's next number.

## Voiding a check

A check that was lost, went stale or was stopped can be voided from the **Printed** list: open the
**...** menu on its row and choose **Void**, then give a reason and press **Void Check**. Its number
stays on the record with your reason on the **Voided** list, and the payment returns to **To Print**
so you can issue a replacement.

To print a replacement straight away, choose **Void and Reprint** instead. You give a reason as
before, and the print panel opens for that payment on the next number.

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
