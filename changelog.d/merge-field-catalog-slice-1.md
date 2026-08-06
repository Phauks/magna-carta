### Document automation — the generated merge-field catalogue

The merge-field dictionary stops being a hand-written array and becomes a **cross product of two small
registries**: subjects (the things a document can talk about — the matter, the client, the opposing
counsel, this office) crossed with facets (the facts a subject of that kind carries). Adding a party
role is now one row whose whole facet set follows; adding a facet is one row every subject of that
kind gains with identical absence behaviour, identical formats, and identical description wording.
The Directory role sources fold into the subject registry rather than living beside it.

- **A committed golden key list makes key permanence a test.** `shipped-keys.json` records every
  shipped key with its value type, source, default rendering, absence behaviour, and sensitivity. A
  key that disappears, changes type, changes source, changes its default rendering, or makes its
  absence _less_ visible is now a failing test naming the key and the property. Adding a key stays
  safe and stays deliberate: it lands as a diff to that file that a reviewer sees.
- **A field carries what a person needs to choose it.** Every entry now has a label, a picker
  heading, the subject it is about, a prominence, search synonyms, and one example rendering per
  legal format — produced by running an invented sample through the real format table, so an example
  can never describe a rendering the formatter does not produce. Whether a field fills itself is
  _derived_ from its source and its subject rather than declared on every row.
- **An absence marker spells out the field's name.** A missing opposing counsel now leaves
  `[OPPOSING COUNSEL'S NAME]` in the draft rather than `[OPPOSING COUNSEL DISPLAY NAME]` — the words
  the author picked from, in the document they are proofreading.
- **A party's name gained renderings.** `displayName` carries the name parts the Directory records,
  so a template can ask for `Ashcroft, Rowan`, `R.T.A.`, `Dr. Rowan T. Ashcroft Jr.`, or the caption
  form. Its default rendering is byte-for-byte the string it always printed, so no registered
  template's output moved. **A rendering the record cannot support is a marked gap with a sentence
  naming the missing part**, never a quiet fallback to a different rendering — a document that
  printed the whole name where a surname was asked for looks finished and is wrong in a way nobody
  catches by reading it.
- **Two new keys.** `client.kind` (person or organisation) and `client.all` (every party linked as
  client, for a repeating block), which the client subject gains from the party facet set.
- **A binding index.** Registration now records which merge keys each template version binds, in the
  same batch as the version itself. It answers "where is this field used", and it turns the guard
  that refuses to destroy a firm's own field a template names from a scan over every stored field
  manifest into an index seek. A template version never changes, so the index can never disagree with
  the manifest it came from.
- **The merge-fields endpoint returns the whole projection** — label, heading, subject, prominence,
  synonyms, per-format examples, availability and its note, status — plus a revision a browser can
  revalidate against instead of refetching tens of kilobytes on every open.
- **The catalog contract's fixture is a checked projection, not an invention.** It had grown a
  practice area, a court case number, and a responsible attorney that nothing could fill in; every
  platform key it names is now a key the engine actually ships, asserted by test. Its value-type and
  group vocabularies are pinned to the engine's for the same reason.
