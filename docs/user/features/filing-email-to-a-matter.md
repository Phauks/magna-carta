# Filing email to a matter

_The backend and the filing API are built. The one-click add-in, the matter correspondence screens, and the capture-address management screens are authored when those surfaces ship; today email is filed by forwarding to a capture address or uploading a message file, and capture addresses are managed through the API._

## What it does

Capture your firm's email correspondence into the right matter, so a matter's file holds its emails alongside its documents. An email is filed **once** and can be linked to **several matters** — it is never duplicated. Its attachments are saved as first-class matter documents, and the original message is kept whole for the record.

## How to file an email

- **Forward or CC it to a capture address.** Each matter can have its own capture address; forwarding or CC'ing a message there files it to that matter. Your firm also has a general capture address that drops mail into a queue for staff to route to the right matter. This works from any email program, on any device.
- **Upload a saved message.** Save an email from your mail program as an `.eml` or `.msg` file and upload it to a matter.
- **(Coming) Save & File from your inbox.** A one-click button in Outlook and Gmail that files the open message to a suggested matter — this is the same filing, done from your inbox. Everything it needs is built: the suggestions below, the filing itself, and the confirmation that it landed.

Every capture lands **staged** for someone to confirm onto the matter — nothing is silently auto-filed to the wrong place. If your firm has set up auto-file rules and an administrator has turned on filing without confirmation, a rule can take that last step for you; see [Auto-file rules](#auto-file-rules) below for exactly what a rule will and will not do.

## Suggested matters

You should not have to search for a matter you are about to file to. When a message is opened for
filing, the right matter is suggested — usually the one you would have picked — from what the message
itself says:

- **The conversation is already on a matter.** A reply to a thread your firm has already filed is
  proposed for that matter. This is the strongest suggestion and is usually the right one.
- **The subject line carries a matter number.** Your firm's own number, written where someone put it.
- **A correspondent is a party on a matter.** Someone on the message is in your Directory and is a
  party on a matter — a client, opposing counsel, an expert.
- **What you typed.** Start typing a client, a title, or a number and matching matters join the list.

Each suggestion says **why** it was suggested and how confident it is, so you can tell a strong answer
from a thin one at a glance. When two matters are equally plausible, none is pre-selected and you are
asked — a suggestion is an offer, never a decision. Nothing is filed until you choose.

**You are only ever suggested matters you can already open.** A matter you have no access to is never
proposed, never named in a reason, and never hinted at by a count.

## Auto-file rules

_The rules themselves and the screens for managing them are being built; this describes what a rule is and how it behaves, so you know what you are turning on._

A suggestion waits for somebody to open a message and choose. An **auto-file rule** does not wait: it
puts a message on the right matter as it arrives, with its reasons attached. That is the difference
that matters on the firm-wide catch-all address, where mail lands today with no matter at all and
somebody has to go and find one.

A rule is something you set up **after** filing a message by hand — "keep filing replies to this
conversation here", "always file mail from this sender here". There are only two kinds, and there is
deliberately no way to write a rule out of keywords or patterns:

- **Replies to a conversation you have already filed.** The strongest signal there is: your firm
  already decided where that conversation belongs.
- **Mail from one sender to one matter.** The sender's address exactly, not their company's domain —
  a bank or a large opposing firm writes to you about many matters at once, so a rule on the domain
  would be wrong more often than right.

### What a staged auto-file looks like

By default a rule **stages** the message: it appears on the matter, marked as waiting for someone to
confirm, with a line saying which rule put it there and why. It is one click from filed, and until
somebody clicks, it is not part of the matter's filed correspondence.

Filing outright — with no confirming click — is a separate choice that takes **two** decisions by two
different people: your firm's owner or an administrator has to allow it for the whole firm, and
somebody has to choose it for that one rule. Until an administrator turns it on, every rule in the
firm stages, whatever any individual rule says. One person cannot opt the firm into it.

Whichever way it lands, a filed or staged message always says which rule was responsible, so "why is
this here" has an answer weeks later without anybody reconstructing it.

### What a rule will refuse to do

Rules are cautious on purpose, and when they are unsure they do nothing rather than guess:

- **It never files when the evidence points at more than one matter.** Two rules disagreeing, a rule
  pointing one way while the subject line carries a different matter's number, a conversation that
  has been filed to two matters — in every case the message waits for a person.
- **It never overrules you.** A message you already filed somewhere is left alone, and a message you
  **removed** from a matter is never put back there.
- **It never files into a matter that is closed**, or into one the person who set the rule up can no
  longer open. Losing access does not silently keep the rule running: the rule stops, and says why.
- **A sender rule needs proof of who sent the message.** Because forwarding breaks a message's
  signature, a sender rule does not fire on mail forwarded to a capture address — there the platform
  can tell who forwarded it, not who sent it. Rules based on the conversation still work on that
  path, which is what makes the catch-all case work.
- **A rule that suddenly goes haywire stops itself.** A mailing list, a bounce loop, or an
  autoresponder shows up as a rule firing far more often than a person would. Past that point the
  rule goes back to staging and asks to be looked at, rather than quietly filing a hundred more.
- **Nothing already in your archive is touched.** Creating a rule never reaches back: it applies to
  mail that arrives afterwards. If you want the last six months filed, select those messages and file
  them.

A rule that stops itself is **suspended, not deleted** — it stays in the list with the reason it
stopped, so you can see what had been happening and decide whether to put it back in service.

### Undoing an automatic filing

Undo is the ordinary **unlink** you would use for anything else: open the message on the matter and
remove it. Nothing special, no separate screen. As always, unlinking leaves the message on any other
matter it is on, and never deletes it.

Undoing is also how you tell the platform a rule is wrong. Undo a rule's filings a few times and the
rule suspends itself and asks — you do not have to go and find it.

## Knowing it filed

Filing a message hands it off and finishes in the background, so a slow or large message never leaves
you waiting on a spinner. You can check on it afterward and be told plainly whether it landed on the
matter, whether it is staged for someone to confirm, and whether your firm already held the same
message — in which case it was added to the existing record rather than filed a second time.

## Managing capture addresses

Capture addresses are created and withdrawn by your firm's owner or an administrator — everyday users
forward to an address, they don't make one. Each address is a long random string at your firm's
capture domain, so it gives nothing away about the client or the matter to anyone who sees a forwarded
thread.

**Treat a capture address like a password.** Anyone who has it can put mail into your firm's file. It
is shown in full **once**, at the moment you create it; after that every screen shows only its first
few characters, so you can tell two addresses apart without the address itself being readable over
someone's shoulder. Copy it somewhere safe when you create it — there is no way to look it up later.
If it is lost, rotate the address rather than hunting for it.

### Create an address for a matter

1. Open the matter and go to its capture addresses.
2. Choose to create one. The full address appears — copy it now.
3. Share it with the people who should be able to file to that matter, and save it as a contact in
   your mail program so it is easy to forward or CC to.

A brand-new address takes a moment to start accepting mail. During that short gap, mail sent to it
bounces back to the sender with a delivery failure — annoying, but nothing is quietly lost. Send
yourself a test message before you hand the address out.

A matter can have more than one address (for example, one shared with a client and one used only
inside the firm), and its list shows every address it has ever had, live and withdrawn, with who
created it and when.

### Rotate an address

Rotating retires an address and hands you a fresh one for the same matter, in one step.

Rotate when an address has spread further than you meant it to — it was forwarded to the wrong list,
it appeared in a thread with the opposing side, it was posted somewhere public, or someone who had it
has left the firm. Rotating is also the answer when an address has simply been lost.

The moment you rotate, the old address stops delivering: anything sent to it afterward bounces. The
matter is never left without a working address, and never briefly has two. Everything already filed
through the old address stays exactly where it is — rotation changes the door, not the file. Give the
new address to everyone who used the old one, and update any saved contact or forwarding rule in your
mail program, or their forwards will start bouncing.

### Revoke an address

Revoking withdraws an address for good, with no replacement. Mail sent to it bounces from the moment
you confirm, so this is the right response to an address you believe is being misused — it stops
delivery first and asks nothing else of you.

Emails already filed through that address are untouched. Revoking an address that someone else has
already revoked is harmless.

### The firm-wide catch-all

Your firm can also have **one** general capture address that is not tied to any matter. Mail forwarded
to it is captured for the firm and lands in a queue for staff to route onto the right matter, rather
than filing itself anywhere. It is the address to use when the right matter isn't known yet, when a
message spans several matters, or as the single address to publish internally so nobody has to look up
a per-matter one.

A firm holds at most one catch-all at a time. To replace it, revoke the existing one and then create a
new one — the same "the address is shown once" rule applies. While no catch-all exists, general mail
simply has nowhere to go, so mint the replacement promptly.

## What gets filed

- **The message** — sender, recipients, subject, date, and body, kept whole.
- **Its real attachments** — saved as matter documents you can preview, version, and search. Like every uploaded file, an attachment is checked for malware before it is available.
- **Not decorative images** — a logo or signature image embedded in the message is not saved as a document (you can promote one to a document later if it matters).

Very large messages are over the size limit for filing and are refused with a message saying so, rather than accepted and lost. A file that isn't actually an email is refused the same way, at the moment you upload it.

## Was this email really from who it says?

Many organizations sign their outgoing mail, and the signature travels with the message. When a message you file carries one, we check it and record the answer beside the message:

- **Signature verified**, naming the domain that signed it — good evidence the message really came from there and has not been altered since.
- **Not verified**, with the reason: the message was never signed (very common, and not a red flag on its own), the signature could not be checked, or the sender's signing key is no longer published.
- **Signature did not verify** — the message does not match what was signed.

**This is information, not a gate.** Nothing is blocked, hidden, or thrown away because of it; every message you file is filed and readable whatever the check says. Treat it as one more fact about a message, the way you would a postmark.

One thing worth knowing: **forwarding usually breaks a signature.** When you forward a message to a capture address, your mail program rewrites parts of it, and the original signature no longer matches — so a forwarded message very often shows as not verifying even though nothing is wrong with it. A message saved from your inbox and uploaded, or filed by the add-in when it ships, keeps the original intact and gives a meaningful answer.

## Already filed

Before you file, the system can tell you a message is **already filed** — so two people working the same email don't file it twice. If it is already on a matter you can access, you're shown which one. If it is only on matters you cannot access, you are told simply that your firm has already captured it — you are never shown a matter you don't have access to.

## Multi-matter and unlinking

- **One email, many matters.** An email that belongs to several matters (related cases, one client with multiple matters) is stored once and linked to each. You see it through each matter you can access, with its own tags per matter.
- **Unlinking is not deleting.** Removing an email from one matter leaves it on the others; the message itself is retained.

## Related features

- **Matters & File Manager** — filed emails and their attachments live in the matter's file area.
- **Directory** — participants on a message are matched to the people and organizations in your Directory where a match exists.
