# Connecting your postage account

Magna Carta buys postage through your firm's own account with the carrier platform, EasyPost. You
connect it once, and from then on anyone allowed to post things can rate and buy labels from
**Shipping & Postage** — see [Shipping & postage](../features/shipping.md).

The page is **Settings › Postage Account**, under **Integrations**. By default only the
**Admin** role can open it.

## Connecting

1. Create an API key in your EasyPost account.
2. Open **Settings › Postage Account** and paste the key into **Account key**.
3. Choose **Connect Account**.

The field hides what you type, so the key is not on screen while you paste it, and it is cleared the
moment the account connects.

**The key is never shown again** — not on this page, and not anywhere else in Magna Carta. It is
stored encrypted and used only when Magna Carta talks to the carrier for you. That is why there is no
"edit" here, only **Replace Key**: there is nothing to edit, because nothing in Magna Carta will read
it back to you. If you lose it, issue a new key in EasyPost and replace it here.

## Reading the connection's health

The top of the page says where the connection stands:

- **Connected.** Postage can be rated and bought.
- **The carrier is refusing the key.** EasyPost no longer accepts the key your firm is connected
  with — it was revoked, or expired. Replacing it restores postage.
- **Failing intermittently.** The carrier has been failing now and then. Postage still works; the
  failures are being recorded.
- **Disabled.** The connection has been switched off.
- **No account connected.** Nothing can be rated or bought. Shipments can still be drafted.

"No account" and "the key is being refused" are one press apart on this page and call for different
fixes, so the page never calls both "not working".

## Replacing the key

Paste the new key into **Replace the account key** and choose **Replace Key**. This is also how to
rotate a key you no longer trust: the new one takes over at once, and the old one is gone from Magna
Carta.

## Disconnecting

Choose **Disconnect Account**, then **Disconnect** to confirm, or **Keep Connected** to change your
mind. Disconnecting stops every carrier operation for your firm and clears the stored key. Drafts,
and the record of everything already sent, are untouched.

## Who can spend postage

Connecting the account does not by itself let every member buy labels. A member needs both
`shipping:manage`, to use Shipping & Postage at all, and `integrations:useConnection`, which lets
Magna Carta use this account on their behalf. By default both belong to the Admin role only.

They are separate on purpose. Using the account for someone is not the same as being able to read
its key: a member who buys labels every day never needs to see the key, and holding
`integrations:useConnection` does not let them. To let someone else buy postage, give their role
both permissions.

## What it costs

Postage is charged to your EasyPost account at the carrier's rate. Magna Carta records the postage
on each shipment, and against its matter when there is one, so it can be billed on to the client.
The platform charges no service fee on a label today; the shipment keeps a separate service-fee
field so that if one is ever charged, it is never folded into the postage a client is billed for.
