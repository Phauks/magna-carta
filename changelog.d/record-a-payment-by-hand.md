---
category: Added
audience: public
---

**Record a Payment, as a bank deposit.** A payment received by hand is now recorded the way it reached the bank: one deposit (account, date deposited, optional slip number) holding up to sixty lines, each naming its own matter and bill, method, reference, payer, date received and amount, plus bank fee lines. Nine methods carry their own details (check, cashier's check, money order, cash with a bill-and-coin count, ACH, wire, card, payment app, other), checked field by field on the server. Postings run through Undeposited Funds, as QuickBooks books a deposit: each line clears receivables on its date received, and the deposit moves the net to the bank and the fees to Bank Fees on the date deposited. Notes and files (PDF, PNG, JPEG up to 25 MB, stored in the firm's R2) attach to a line or to the whole deposit, and are viewed in the page. The total is worked out from the lines, never typed. New page `/billing/payments/new` (from Billing's New menu, or Record Payment on a bill), a deposit page at `/billing/deposits/{id}`, and routes under `/api/v1/billing/deposits` and `/api/v1/billing/open-bills`. The one-bill Record Payment dialog is gone.

## Public

**Record a Payment.** Record a deposit of checks, cash, transfers and card payments in one go, each line paying its own matter's bill, with scans and notes attached.
