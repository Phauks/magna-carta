---
category: Added
---

The design for **exhibits and exhibit lists** — building the set of exhibits attached to a motion,
reordering them freely while everything that cites them keeps up, and then filing it, after which
nothing can renumber it. Design only; no product code.

**The whole problem is that three things move independently and one of them is invisible.** An
exhibit has an attachment (a document, with its own versions), a label (Exhibit A, Exhibit 3 — which
is just a position, so inserting one renumbers everything after it), and every sentence in the brief
that says "as shown in Exhibit C". The first two are on a screen where somebody would notice. The
third is scattered through prose a person wrote weeks ago, and a citation that quietly starts pointing
at the medical records is worse than having no feature at all, because the document still looks
finished. So the design's first move is to stop treating those three as one fact. **The exhibit is a
thing** — the employment agreement — with a short name that is minted once and never changes again,
even when somebody retitles the exhibit to "Executed Employment Agreement (2019)". **The position is a
row in a set.** **The label is arithmetic**, worked out from the position every time it is read, and
never written down anywhere it could go stale.

**References cite the thing, not the number.** A citation in the document says, in effect, "the
employment agreement", and the number appears only when the document is produced. Move the exhibit and
every citation in that document follows in the same instant — there is no button to press and no field
to refresh, which is exactly where Word's own cross-references let people down. And a citation to
several exhibits lists them by name rather than as a range: writing "Exhibits B through D" as a span
is a citation that survives an insertion and quietly acquires an exhibit nobody meant to cite, so the
design makes that unwriteable. Naming three exhibits prints "Exhibits B through D" today and "Exhibits
B, D, and F" after somebody inserts two in the middle — which is what the author meant both times.
Inserting one is a picker, not a syntax: you choose the exhibit and read "Exhibit C" in place, and what
the document actually stores is the name.

**Once it is filed, it is frozen, and that is a real state and not a warning.** Reordering exhibits
after a motion is served cannot renumber a document sitting on a docket — opposing counsel has it, and
the filed copy is the authority. So a set has exactly two states. While it is a draft it is a plan:
rearrange it all you like. When it goes out, every label, every title, and the exact version of every
attachment is written down and locked by the database itself, and the set can never gain a member,
lose one, or renumber. Because the platform has no connection to any court's filing system and will not
pretend to, saying "this went out" is something a person records, with a date and whether it was filed,
served, exchanged, or lodged — and it cannot be taken back. Fixing a genuine mistake about what was
filed is still possible and is deliberately narrow; changing what was actually filed is a **new** set
that supersedes the old one, with the old one kept exactly as it was, because both filings really
happened. That is the same line the calendar already draws between correcting a hearing that was
recorded wrongly and recording a hearing the court actually moved.

**Pulling an exhibit after filing does not free up its letter.** It is marked withdrawn and stays in
place, and the letter is retired for good — two different documents both correctly cited as "Exhibit C"
is a mix-up nobody reading the record can untangle. A later filing that continues the numbering starts
after the retired letter, not on top of it.

**Nothing about numbering is hardwired to a jurisdiction, and the reason is Nevada itself.** Two
departments of the same Las Vegas courthouse currently direct incompatible schemes — one says numbers
for the plaintiff and letters for the defendant, another says the plaintiff starts at 1 and the
defendant at 500. A built-in rule would be confidently wrong inside one building. So the numbering
scheme belongs to the set: the word ("Exhibit", "Attachment", "Tab"), anything in front of it
("Plaintiff's"), letters or numerals or roman numerals, and where the count starts. The platform can
offer starter presets to copy, and will never treat one as a rule.

Also settled: exhibits come from files that already exist — a matter file, a scan of a physical
original the firm holds, a document from discovery, or something the platform assembled — and never
through a second way of getting files into the system. The exhibit list is produced twice on purpose,
as a live table on screen that is always current, and as a real document assembled from a template a
firm can edit, because that is what gets filed. Separator sheets (Nevada requires "Exhibit \_\_\_" centred
in 24-point type) are generated fresh every time a package is built and are deliberately never saved as
documents, because a saved separator sheet is a stale label waiting to be filed. And an exhibit's label
and a Bates number are kept firmly apart: reordering exhibits never touches a Bates number, and where an
exhibit came from a production its Bates range travels with it as a column on the list.

The first slice is deliberately the useful half without the clever half: build a set, reorder it, print
the list, record that it was filed. In-text references, the compiled exhibit package with its separator
sheets, and citations across filings follow.
