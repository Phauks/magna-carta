# Safe custody register

_The register and its API are built. The screens — the register list, packet detail, the location
tree, and check-out/check-in — are authored when those surfaces ship. Review reminders, printable
labels, destruction approval, and client-portal visibility are not built yet._

## What it does

Keeps track of the physical originals your firm holds for people: wills, deeds, share certificates,
passports, keys, sealed instructions. For each one the register answers three questions at any moment
— **what do we hold, where is it, and whose is it** — and keeps a permanent record of everywhere it
has been.

The register is built around two ideas worth knowing before you use it.

**A packet is what you hold; an item is what's inside it.** The packet is the physical thing that
moves: an envelope, a deed box, a sealed wallet. The items are what it contains — "original will of
Jane Smith dated 14 March 2019", "share certificate, 200 ordinary, Acme Holdings". You move a packet;
you describe items. A packet can start with nothing itemized and be filled in later.

**Every packet belongs to somebody named.** You cannot log a packet without linking it to a person or
organization in your directory. This is deliberate and there is no way around it: the worst thing that
happens in safe custody is not a misplaced envelope, it is an envelope nobody can attribute — one that
can never be returned to its owner and never be destroyed.

## Logging something into custody

1. Open the register and choose to log a packet.
2. Give it a name you would recognize on a shelf ("Smith family deeds").
3. Link at least one **owner** from the directory. You can add more than one — a joint will packet has
   two — and you can give each a short role: owner, joint owner, life tenant, trustee, executor.
4. Record the **depositor** if it was not the owner who handed it over. A son depositing his mother's
   will, or a former solicitor transferring a file on a practice closure, is a fact about the deposit
   that should not be lost when ownership later changes.
5. Choose where it is going — the safe, box, or shelf it will live in.
6. Link a **matter** only if there is one. Most packets have none, and that is normal: a will held for
   a client whose last matter closed eleven years ago is the ordinary case, not an oversight.

The register gives the packet a **custody number** — the number you write on the label and read out
over the phone. If you are moving in from a paper deeds register or another system and your packets
already have numbers on their labels, enter the existing number instead; the register will use it and
you do not have to re-label the safe.

Then itemize it: add one entry per thing inside, with a description, the type, and the item's own date
where it has one (a will's date is what people actually search by).

**Irreplaceable originals are flagged.** Most types — wills, deeds, certificates — are flagged
automatically as irreplaceable, and you can set or clear the flag on any specific item. The flag is
what stops an original from ever being destroyed on a schedule, so set it honestly.

## Where things are kept

Your storage is described as a tree: an office holds rooms, a room holds safes, a safe holds boxes, a
box holds positions. You choose how deep to go — a firm with one safe and numbered pigeonholes needs
two levels.

**Not everything is in your office.** A bank safe-deposit box, an offsite records vendor, or a
co-trustee's premises can each be added as its own top-level location with its own address. These are
not offices, so they never appear in your firm's office lists, letterhead, or reporting.

A location can be closed when you stop using it, but **not while anything is still in it** — the
register will tell you how many packets are there. Move the contents somewhere first.

## Checking something out, and getting it back

Recording a check-out takes one step, and it always captures **who has it**:

- a member of your firm (a partner taking a deed to a completion meeting),
- someone from your directory (the client's accountant collecting a share certificate), or
- a named individual with no directory record (a courier's driver signing for it).

Give it a **due-back date**. This is the one field that does the most work in the whole register: the
overdue list is built from it, and it is the reason you find out that a deed has been in someone's
office for five weeks.

Checking it back in records where it went back to. You can also move a packet between locations, take
a single item out of a packet, mark something released to its owner, or record that something is
**lost** — recording a loss honestly is far better than a register that quietly cannot say.

Every one of these is written into the packet's history with the date it actually happened, which may
be earlier than the day you type it in. Back-dating is supported and expected: a Friday collection
entered on Monday is the normal case.

**History is never edited.** If you record something wrongly, you record a **correction** that points
at the entry it corrects. Both stay visible. That is what makes the register worth something if it is
ever questioned — nobody could have gone back and made it say something else.

## Holds

Put a **hold** on a packet or an item when it must not leave: a legal hold, a discovery hold, a client
instruction, a dispute, or because you cannot locate the owner.

A hold stops the property being **released or destroyed**. It deliberately does **not** stop you
moving it — a held original still needs to be movable to a fireproof safe or an offsite site. Holds
are released explicitly, and both the placing and the releasing show up in the packet's history.

## Scans

You can attach scans, photographs, receipts, appraisals, and correspondence to a packet or to one item
inside it. Upload the document the way you upload any other document, then link it to the packet.

**A scan is never a substitute for the original**, and the register will not treat it as one. Having a
scan of a will does not make the will itself any more disposable — that is exactly the reasoning that
loses originals, and the register refuses to encode it.

## Who can see and do what

- **Reading the register** is available to everyone at the firm. "Do we hold the deed for this client"
  is a question anyone might legitimately need answered.
- **Changing it** — logging packets, moving them, checking them out, placing holds — is limited to the
  people your firm trusts with the safe. By default that is owners and administrators, attorneys, and
  paralegals.

Bear in mind that the register's contents are sensitive on their own. That your firm holds an original
will for a named person is a disclosure even with no document attached, so treat a screen showing the
register the way you would treat the safe itself.

## What is not here yet

- **Review reminders.** You can note that a packet should be looked at again, but nothing emails you
  yet.
- **Retention and destruction.** There is no destruction workflow you can run, and the platform ships
  **no default retention periods** at all — deliberately. How long a firm must keep a client's property
  varies by jurisdiction, and the guidance that matters most says originals of intrinsic value sit
  outside any routine clock. Your firm sets its own; the platform will never quietly decide for you.
- **Printable labels and barcodes.**
- **Signed deposit and release receipts**, and identity checks before an original leaves.
- **"Items we hold for you" in the client portal.**
- **Stocktake** — scanning a shelf and reconciling it against what the register expects.
- **Will lodgement deadlines on death.** These carry real statutory teeth and vary sharply by state,
  so they are not encoded until they can be verified against the primary text rather than guessed.

## Related

- [Filing email to a matter](filing-email-to-a-matter.md)
- [Shipping & postage](shipping.md) — for sending originals by courier or certified mail
