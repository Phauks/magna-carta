---
category: Changed
audience: public
---

**A trust check print is recorded as printed at once.** `composeTrustCheckPrint` writes a `printed`
event beside each numbered check in the same batch, and the results route
(`POST /api/v1/trust/checks/results`) with `composeTrustCheckResults` is removed: a misprint is a
void from the row, which returns the payment to the print list. The next check number continues one
past the last printed check unless the stock was saved after it. The Checks screen carries the first
check number beside Print; Confirm Print shows the numbers read-only.

## Public

**Printing trust checks is shorter.** Printed checks are taken to be right, so nothing asks you
afterwards. If a check misprints, choose **Return to List** on its row: the number is voided and
kept, and the payment waits to be printed again. The first check number now sits on the Checks
screen beside Print, and the next number follows on from the last check you printed.
