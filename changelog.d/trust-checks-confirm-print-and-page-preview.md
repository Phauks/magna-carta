---
category: Changed
audience: public
---

**Trust check printing takes a Confirm Print step and a person-set check number.** The Checks
screen opens `check-confirm-print-dialog.svelte` before anything is numbered and sends the confirmed
`firstCheckNumber` with the print; a refusal over a used number marks the field red and shows the
server's sentence in the panel's failure band. Misprinted checks hand their payments back into
Confirm Print, Void and Reprint does the same from a printed row, and the header's Change saves the
stock again with a new starting number. The stock editor draws each page layout and the whole chosen
page from `checkPage` in `check-document.ts`, the same lines the PDF is set from, on two new still
parts of the design system's placement board (`PlacementBoard.Region`, `PlacementBoard.Mark`). The
developer gallery's switches are renamed in plain words and can open each panel at once.

## Public

**Printing trust checks: a Confirm Print step, the check number in your hands, and the whole page
shown as it prints.** Print Checks now opens Confirm Print, which lists the checks in the order they
will come out and lets you set the first check number for the batch. You can change the account's
next check number at any time from the Checks screen. After printing, you record each check as
Printed Right or Misprinted, and a misprinted check goes straight back to Confirm Print on the next
number. A check already recorded as printed can be voided and reprinted from its row. The check
stock editor shows each page layout as a miniature of the letter page, and the whole chosen page as
it will print, with sample values.
