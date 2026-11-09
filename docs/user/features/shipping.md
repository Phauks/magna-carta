# Shipping & postage

Send mail and packages — including **USPS Certified Mail** with a return receipt and signature —
without leaving Magna Carta. Your firm connects its shipping account once; after that, anyone
allowed to post things drafts a shipment, compares live carrier rates, buys the label, prints it,
and tracks the parcel, all from **Shipping & Postage** in the sidebar.

A shipment can belong to a matter. When it does, its postage is recorded against that matter so it
can be billed on to the client.

## Before you start

Postage is bought through your firm's own account with the carrier platform (EasyPost). An
administrator connects it once, in **Settings › Postage Account** — see
[Connecting your postage account](../admin/postage-account.md).

Until it is connected you can still **draft** shipments, and nothing you draft is lost. Rating,
buying, tracking and voiding all need the account, and the Shipping & Postage page says so at the
top rather than showing an empty list that looks like a firm that has never posted anything.

## Sending something

Choose **New Shipment**. It takes five short steps, shown across the top of the page, and **Back**
keeps everything you have entered.

1. **Recipient.** Who it is from and who it is going to: name, street, city, state and ZIP for
   each. The country is the United States. Optionally, the **Matter** this mailing belongs to.
2. **Package.** Its weight, in ounces.
3. **Options.** **Certified mail**, a **return receipt** (none, electronic or physical), and a
   **signature** (none, signature, or adult signature).
4. **Rates.** Choose **Get Rates** and Magna Carta asks the carrier what it can do for this package
   and these addresses. Pick one service.
5. **Confirm.** Check the postage and choose **Buy Label**.

The shipment is saved as a draft as soon as you ask for rates. If the rates cannot be fetched — most
often because no account is connected — the draft is kept in the list, so you do not have to type it
again.

**A label is bought once.** If buying fails part way, check the shipment in the list before trying
again: a purchase that failed on the way back to Magna Carta may still have gone through at the
carrier, and the shipment's status is what says which.

## Finding a shipment, and where it is

**Shipping & Postage** lists everything your firm has sent, newest first. Choose which columns to
show, sort, and filter, as on any other list in Magna Carta. Postage and the service fee are separate
columns, because postage is billed on to a client and the fee may not be.

Open a shipment to read it over the list. It shows who it went to and from, its status, its tracking
number, what it cost, and its matter. From there:

- **Tracking.** Open the **Tracking** tab and choose **Check now**. Magna Carta asks the carrier
  where the parcel is at that moment, and says when it asked — tracking is never a stale answer
  presented as a current one.
- **Label.** Opens the label to print. It is kept in your firm's own storage, so it still opens
  weeks later, after the carrier's own link has expired. **Print** does the same.
- **Void Label.** Refunds a label that has been bought but not used. Offered only while the label is
  unused; a parcel already moving is not refundable this way.

Close the shipment to go back to the list. A link to a shipment opens the list with that shipment
already open.

## Who can do what

Shipping has two permissions, and a member needs both to spend postage:

- `shipping:manage` lets a member use Shipping & Postage at all — draft, list and open shipments.
- `integrations:useConnection` lets Magna Carta use the firm's postage account on that member's
  behalf, which is what rating, buying, tracking and voiding do.

By default both belong to the **Admin** role and to no other. If your firm gives a member
`shipping:manage` without `integrations:useConnection`, they can prepare shipments but not buy them —
someone who holds both buys the label. The refusal names the missing permission when that happens,
rather than reporting a fault with the account.

## Related features

- Matters — link a shipment to a matter so its postage is recorded for cost recovery.
- [Connecting your postage account](../admin/postage-account.md) — for administrators.
