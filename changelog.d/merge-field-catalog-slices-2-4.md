### Document automation — the firm's people, the court, and the estate become merge subjects

The merge-field catalogue gains its three platform record sources — fifty-five new keys, three new
batched reads, and not one read more however many of them a template names.

- **Our people.** A matter now records its staffing beyond the responsible attorney —
  `matter_assignment` rows in free-text working roles, matched by the same letters-and-digits rule
  party roles use — and five member subjects resolve from one staffing read: the responsible,
  originating, supervising, and billing attorneys and the assigned paralegal, each with name (every
  name rendering, from the member's mapped Directory person), title, email address, and direct dial
  from the new member professional profile, and an `.all` collection for a repeating block. Two
  supervising attorneys is the same honest answer two opposing parties always got: an absence naming
  the count, with the collection as the way out. The responsible attorney's one home stays the
  matter record itself — an assignment in that role is refused at the door.
- **A member's bar number is the first protected fact about the firm's own people.** It lives
  encrypted on the member's mapped Directory record, decrypts only through the same permission-gated,
  audited chokepoint the client's identifiers use — and is never even attempted for a staffing slot
  that resolved ambiguously, so an assembly cannot generate a decrypt audit trail for a member the
  document never names.
- **Court and case.** The matter's court-case record carries the court (a Directory organisation),
  the judge (a Directory person, in any name rendering), the case number, division, department,
  filing date — and the two designation words this court's captions actually use. Side is a recorded
  caption fact, never a key axis: `{{case.clientDesignation}}` prints "Petitioner" where a fixed
  plaintiff/defendant pair would simply be wrong.
- **The estate, by its several names.** The estate record stores the decedent (every name rendering
  applies to `estate.decedent`), the date of death, the proceeding type, the letters-issued date —
  and the estate's style and short style exactly as the court fixed them, stored and never composed.
- **The capacity line composes in the resolver, never in the template.**
  `{{client.capacityLine}}` renders "Devon Marchetti, as Administrator of the Estate of Rowan
  Ashcroft, Deceased" from three recorded facts — the party's name, the capacity on the party link
  (a new recorded fact), and the estate's stored style. When any part is unrecorded the whole phrase
  is ONE absence with a sentence naming which part — where a hand-concatenated template renders
  stray punctuation and three markers.
- **An estate's asset schedule now speaks as of the date of death.** When a template walks the asset
  register on a matter with a recorded date of death, the figures resolve as of that date rather
  than the assembly's own.
- **Pleading-caption and probate-petition fixtures** join the engine's validation suite in the
  shapes the profession files, asserted over the emitted document parts.

Deliberately waiting on the structured-value slice: the member's office address, the court's
address, and the signature block as merge facets — each needs the structured address type or real
line-break emission, and shipping them as flattened text would produce documents that look right and
are subtly wrong. The records store the facts today; the facets follow with the machinery.
