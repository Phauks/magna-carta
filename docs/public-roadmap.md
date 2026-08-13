# Magna Carta roadmap

What we are building, and roughly where each piece has got to. It is written for the people who use
Magna Carta rather than the people who build it, and it is a companion to the
[changelog](public-changelog.md): the changelog says what has arrived, this says what is coming.

Magna Carta is being built and is not yet generally available, so most of what follows is on its
way rather than in your hands. The bands say how far along each piece is.

**There are no dates here, and there will not be.** Work is grouped into bands — Building Now,
Planned, Future and Completed, with anything we have decided against at the end — and nothing
carries a target quarter or a delivery date. A date on a page like this is a promise made before the
work is understood, and a missed one costs more than it ever bought. What you can rely on instead is
that the bands are true on the day you read them: each is derived from the state of the work itself,
not maintained by hand.

**Things move backwards sometimes.** A capability can go from Planned to Future when something more
urgent lands in front of it, or when the design turns out to be wrong. When that happens it moves on
this page too, rather than sitting in a band it has left.

This file is **assembled, never hand-edited.** It is rendered from the feature ledger the build runs
on, so an entry cannot describe a state the work is not actually in.

## Building Now

Being worked on right now.

### Assistance and AI

- **Magnus, the in-app assistant** — Ask a question about your matters in plain language and get an answer, with nothing you ask retained by the model provider.

### Security and sign-in

- **Accounts and permissions** — A named account for everyone at the firm, with roles that decide what each person can open, change and see.
- **Two-step sign-in** — Protect an account with a second step: a code from an app, a hardware key, or a passkey instead of a password.
- **Encryption of sensitive fields** — Identifiers and other sensitive details are encrypted with keys held for your firm alone, not merely stored behind a login.

### Calendar and deadlines

- **Calendar and deadlines** — Hearings, deadlines, firm events and room bookings in one calendar, with every date on a matter visible as that matter's own timeline.

### Communications

- **Email filed to the matter** — Send and receive client email from the firm's address and have each message filed against the right matter.

### Conflicts

- **Conflicts checking** — Check a prospective client or matter against everyone the firm has acted for or against, and keep a permanent record of what the check returned and who cleared it.

### Clients, matters and offices

- **One record for every person and organization** — Clients, opposing parties, courts, experts and vendors in one place, with the relationships between them held as facts rather than notes.
- **Matters** — Open a matter, set who is involved and how it is numbered, and keep everything about it in the one place for the life of the file.
- **More than one office** — Run several offices, with staff, matters and letterhead attached to the right one and nothing hidden from the rest of the firm.
- **Fields you define yourself** — Add your own fields to clients, matters and assets, and use them in searches, reports and generated documents.
- **Asset registers** — Track the property, accounts and possessions a matter deals with — what each is worth, what is owed against it, and who holds an interest.

### Physical custody

- **Safe custody register** — Record every original will, deed and physical item the firm holds, where it is kept, and who has it now.

### Discovery

- **Discovery** — Load what the other side produced, process it, and work through it at the volumes litigation actually produces.
- **Review and coding** — Tag documents for responsiveness and privilege, with each reviewer seeing only the set they have been given.
- **Productions** — Produce a set with stamped numbering, the redactions burned in, and a load file the other side can open.

### Document automation

- **Documents built from your templates** — Build a document from your own template and the matter's data, including the clauses that only apply in some cases.

### Documents

- **Files on a matter** — Every file on a matter in folders you control, with each version kept as you save it.
- **Editing in the browser** — Open and edit a document in the browser without downloading it, and keep the version history as you work.
- **PDF tools** — Redact, combine, split, rotate, fill, stamp and password-protect a PDF without sending the file anywhere else.
- **Electronic signatures** — Send a document for signature and get the signed copy back with a record of who signed it and when.
- **Court bundles** — Assemble an indexed, paginated bundle from the files already on the matter.
- **Opening a locked file** — Unlock a password-protected file when you have the password, and attempt recovery when the client no longer does.
- **Metadata scrubbing** — See what is hidden inside a file — tracked changes, comments, author details, the place a photograph was taken — and strip it out before you send it.

### Time, trust and billing

- **Time tracking** — Record time as you work — a running timer, a quick entry, or a weekly grid — against the matter and the rate that applies on that day.
- **Trust accounting** — Hold client money in trust with a balance per client that cannot go negative, and the rules of your jurisdiction enforced rather than described.
- **Billing and invoices** — Raise a bill on any fee arrangement, apply trust money to it, correct it afterwards without editing it, and send it out.
- **Costs and disbursements** — Record what the firm has laid out on a matter, from a filing fee to postage, and recover it on the bill.

### Integrations and tools

- **Postage and shipping** — Buy a label, track the package, and have the cost land on the matter.
- **Built-in tools** — Small utilities where you need them: company and attorney-license lookups, county property records, domain and website checks, and file inspection.

### Notifications

- **Notifications** — Be told when something needs you, in the app and by email, and only ever about matters you already have access to.

### Reliability and support

- **Reporting a problem** — Report a problem from inside the app and get a reference you can quote to us, without sending us the contents of your file.

### Early access

- **Early access to new features** — Turn a new feature on for your firm before it reaches everyone, and turn it off again if it gets in the way.

## Planned

Decided and designed. Queued to be built.

### Community

- **Feature requests and voting** — Ask for what your firm needs, vote on what other firms have asked for, and see what we decided and why.

### Discovery

- **Search across a review set** — Search a review set by keyword and by meaning, and narrow it as you go.

### Reports

- **Reports** — Reports on money, time, trust compliance and productivity — on screen, exported, or sent to you on a schedule.

## Future

Intended, and not scheduled. Some of these are still being researched.

### Assistance and AI

- **Client consent for AI** — Decide, for each client, whether their information may be sent to an AI model at all — and have that decision enforced rather than remembered.

### Calendar and deadlines

- **Two-way calendar sync** — Keep the firm's calendar and your Google or Outlook calendar in step, in both directions.
- **Deadlines calculated from court rules** — Enter the trigger date and have the deadlines that follow from it calculated under the rules of the court you are in.
- **Deadline reminders** — Be reminded of a deadline before it arrives, on the notice you choose.

### Communications

- **Text messaging** — Text a client from a firm number and keep the whole thread on the matter.
- **Calls and voicemail** — Take and make firm calls in the app, with voicemail and call records kept on the matter.

### Client intake

- **Client intake** — Take an enquiry, check it for conflicts, and turn it into a matter without typing anything twice.

### Integrations and tools

- **Third-party add-ons** — Connect tools built by other people, without giving them the run of your data.

### Payments

- **Client payments** — Let a client pay a bill by bank transfer or card, with card fees kept away from trust money.

### Apps and access

- **Desktop app** — The same product as an application on your own machine, with the browser version always available and no feature only in one of them.

### Client portal

- **Client portal** — Share documents, updates and bills with a client through access you can time-limit and withdraw.

### Tasks and workflows

- **Tasks and matter plans** — Task lists on a matter, and a plan that lays them out for you when a matter of that kind is opened.

## Completed

Delivered and in use. See the [changelog](public-changelog.md) for what each one does and when it arrived.

### Reliability and support

- Service status page
- Audited support access
