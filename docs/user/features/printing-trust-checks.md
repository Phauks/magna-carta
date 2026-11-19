# Printing trust checks

_In daily use once your account's check stock is set up._

## What it does

When a payment out of a trust account is recorded as paid by **check** and no check number is
typed in, it waits on the account's **Checks** screen to be printed. You set the number on the
first sheet in your printer, a PDF opens to send to the printer loaded with your check paper, and
when they have printed you mark them printed. Printed checks are taken to be right. If one jammed or
printed crooked, return it to the list: its number is voided and kept, and the payment waits to be
printed again on a new number.

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

Every payment waiting on **To Print** starts ticked. Untick any you are not printing. Above the
list is the **First Check No.**: the number on the next sheet of paper in your printer. It
starts one past the last check you printed (or at the stock's **Next Check Number** if you saved
the stock since), and you can type any number. Each ticked row shows the number it will print on,
and follows the field as you change it.

Press **Print N Checks**. A PDF of the checks opens in a new tab; print it from there. Nothing is
recorded yet. Back on the Checks screen the button now reads **Mark N Printed**: press it once the
checks are out of the printer, and they move to the **Printed** list with their numbers. Press
**Cancel** instead if you did not print them; nothing is kept. If you change the ticked payments or
the first number before marking them, the button goes back to **Print N Checks**, because the PDF
no longer matches.

If one of the numbers is already used on the account, the screen says which one, the field turns
red, and nothing is recorded. If your browser blocks the tab, allow pop-ups for the site and press
**Print N Checks** again.

## A check that misprinted

Open the **...** menu on its row on the **Printed** list and choose **Return to List**. The reason
starts as **Misprinted**; change it if you like and press **Return to List**. The check keeps its
number on the **Voided** list with the reason, and the payment is back on **To Print**. Print it
from there with the rest; it gets a new number.

## Voiding a check

A check that was lost, went stale or was stopped is handled the same way: **Return to List** from
its row, with a reason such as **Lost in the mail**. Its number stays on the record with your reason
on the **Voided** list, and the payment returns to **To Print** so you can issue a replacement.

Voiding a check does **not** cancel the payment. The money left the client's ledger when the
payment was approved. If the payment itself should not happen, record a deposit back to the
client's ledger as well.

A sheet torn in the printer before it was printed can be voided with **Void Next Number** in the screen's **...** menu, so the
numbers on screen keep matching the paper.

## Positive pay file

Many banks offer **positive pay**: you upload a list of the checks you issued and voided, and the
bank refuses any check presented that is not on it. To make that list, open the **...** menu on the
Checks screen and choose **Positive Pay File**.

1. Pick the dates. **From** starts on the first of this month and **To** on today.
2. Enter the bank account's full **Account Number**, digits only. It is not saved anywhere, so you
   enter it each time.
3. The line under the fields says how many checks the file holds and how many of those are voided.
   Press **Download**.

The file lists every check whose number was used in those dates, and every check voided in those
dates, even one printed earlier. A number voided before anything printed on it goes in as a void
for 0.00 with no payee. Each row has the account number, check number, issue date, amount, payee
and **Y** or **N** for void. The matter and memo are left out.

The file is a plain CSV in the layout most banks accept.

## A check you wrote by hand

If you record a payment by check and type the check number yourself, it is never put in the print
list. Its number is still what the bank statement is matched against during reconciliation.

## Who can do what

Anyone who can see the firm's trust accounts can see the checks. Printing, voiding and
setting up check stock need the trust management right. Printing a check moves no money, so it does
not need a second person.
