# Recording a payment

## What it does

Records money a client paid you directly, the way it went into the bank: one deposit, with a line
for each payment in it. A line can be a check, a cashier's check, a money order, cash, an ACH or
wire transfer, a card you ran on your own terminal, a payment app such as Zelle, or something else.
Each line pays one bill on one matter, so one deposit can pay bills on several matters at once.

The money goes on your books in the account you deposited it to, and each bill's balance comes down
by its line's amount.

Online payments (a client paying by card or bank account through a payment page) are not here yet.

## Recording one

1. Open **Billing**, choose **New**, then **Record a Payment**. Or open a bill and choose **Record
   Payment** in its Payments & Credits tab, which starts the deposit with that bill on the first
   line.
2. At the top, fill in the deposit:

| Field            | What to enter                                                           |
| ---------------- | ----------------------------------------------------------------------- |
| Deposit To       | The bank account the money went into. Your default account is filled in |
| Date Deposited   | The day you took it to the bank or it reached the account               |
| Deposit Slip No. | Optional, under **Add Detail**. The number on the bank's deposit slip   |

3. Fill in a line for each payment:

| Field         | What to enter                                                                               |
| ------------- | ------------------------------------------------------------------------------------------- |
| Matter        | The matter the payment is for                                                               |
| Bill          | The bill it pays. A matter with one open bill picks it for you                              |
| Method        | How it was paid                                                                             |
| Ref No.       | The check number, serial number, trace number or approval code. Optional for cash and Other |
| Received From | Who paid. It starts as the matter's client                                                  |
| Date Received | The day the payment reached you, which can be before the date deposited                     |
| Amount        | What was paid. It starts as what the bill still owes                                        |

4. Choose **Record Payment**.

Required fields are marked with a star. If something is missing or wrong, the field is outlined in
red; point at it to see why.

## Lines

- **Add Line** adds a line at the bottom. **Add Bank Fee** adds a fee the bank kept, such as a
  deposit item fee, which comes off the deposit total.
- The **...** menu at the end of each line has **Duplicate**, **Insert Line Below**, **Attach a
  Scan**, **Attach a File**, **Add Note**, **Move Up**, **Move Down**, **Clear Line** and **Delete
  Line**. Duplicate is quickest for several checks on the same bill.
- Open a line with the arrow at its start to see its details. Each method has its own: the date and
  bank on a check, the issuer of a money order, the card brand and last four digits, and so on. The
  ones you don't usually need are under **Add Detail**.
- For cash, choose **Count by Bill and Coin** to enter how many of each bill and coin. The amount is
  the counted total.

## Totals

The deposit total is worked out for you: the lines added together, less any bank fees. It should
match the deposit slip or the bank statement. **Bills Paid** below the lines shows each bill, what
this deposit pays on it, and what is left to pay.

## Scans, notes and files

Each line takes its own scans, files and note: a scan of the check, a wire confirmation, a receipt.
The deposit as a whole takes them too, for example the deposit slip. Click a file to view it on the
page, or download it. PDF, PNG and JPEG files up to 25 MB are accepted.

Files are sent after the deposit is recorded. If one fails to send, the deposit is still recorded,
and its page says which file to add again.

## After recording

The deposit opens on its own page, with every line, the totals, the files and the notes. You can add
files and notes there later. Each note can be on the whole deposit or on one line.

## What to know

- **One deposit, one bank deposit.** Record each trip to the bank, or each deposit on the bank
  statement, as its own deposit. That keeps the books matching the bank.
- **Only a finalized bill can be paid.** A draft is still being written.
- **A line can't pay more than its bill still owes**, counting the other lines on the same bill. If a
  client overpays, record what the bill is owed, then return or credit the rest.
- **Dates:** the date received can't be after the date deposited, or before the bill was issued.
- **One currency per deposit.**
- **Trust money is different.** Money a client sends for you to hold is a trust deposit, recorded on
  the client's trust ledger. To pay a bill from it, use **Apply Trust Funds** on the bill.

## Fixing a mistake

A recorded payment can't be edited or deleted. If a line went against the wrong bill or for the
wrong amount, reverse it (see [Correcting a bill](correcting-a-bill.md)) and record it again. The
deposit's page shows the reversed line struck through, so the history shows exactly what happened.

## Related features

- [The firm's bills](the-firms-bills.md)
- [Correcting a bill](correcting-a-bill.md)
- [Recording that a bill went out](recording-that-a-bill-went-out.md)
