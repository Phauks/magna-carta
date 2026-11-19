---
category: Added
audience: public
---

**Record a payment against a bill.** A finalized bill now takes a payment the firm received directly: a check, cash, a bank transfer, or a card run on the firm's own terminal. Record Payment in the bill's Payments & Credits tab posts Dr Operating Bank / Cr Accounts Receivable through the account-role map, lands a `payment` application under the balance CHECK, and keeps the method and the firm's reference in a new append-only `payment_receipt` table. A payment cannot exceed what the matter still owes; one recorded in error is undone by reversing its application. New routes: `POST` and `GET /api/v1/billing/invoices/{invoiceId}/payments`.

## Public

**Record a payment.** Mark a bill paid when a client pays by check, cash, bank transfer or card.
