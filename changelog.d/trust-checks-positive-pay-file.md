---
category: Added
audience: public
---

**The Checks screen downloads a positive pay file.** The page menu's Positive Pay File opens a
dialog with From and To dates and the bank account number, and Download saves a generic CSV
(`Account Number,Check Number,Issue Date,Amount,Payee,Void`) of the checks issued or voided in
those dates through the shared save seam. The account number is typed each time and never stored.
Payees are quoted and guarded against spreadsheet formulas. `@magna-carta/money/format` gains
`decimalText` for an exact plain decimal amount, and `render-csv.ts` exports `csvField`.

## Public

**Positive pay file for trust checks.** On a trust account's Checks screen, open the ... menu and
choose Positive Pay File. Pick the dates, enter the bank account number, and download the list of
checks issued and voided to upload to your bank.
