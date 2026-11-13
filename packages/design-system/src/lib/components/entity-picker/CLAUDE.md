# The directory-linking family — CLAUDE.md

The entity picker, the parties field and the parties tab: one mark, one field, one tab. The package-wide rules are in [`../../../../CLAUDE.md`](../../../../CLAUDE.md).

## The directory-linking family: one mark, one field, one tab

**Every surface that names, picks or links a person or an organization goes through
`EntityIdentity`, `EntityPicker` and `RecordParties`** (`src/lib/components/entity-identity`,
`entity-picker`, `record-parties`). Three app surfaces had each hand-built a combobox over the
directory search before these existed; the one-implementation registry now refuses a fourth.

- **The picker never fetches.** It takes `search: EntitySearch` and owns the settle, the floor, the
  abort of a superseded question and the three states (`picker-search.ts`, tested on its own). The
  app supplies the directory — `apps/web/src/lib/directory/directory-picker-source.ts` is the one
  adapter. Same layering as `ActionDialog`'s `notice` slot: the design system knows how a search
  behaves, never what is searched.
- **A failed search is stated, never rendered as no matches.** The two are the same picture and not
  the same fact. A capped answer says so and is never re-sorted: the order is the server's.
- **An association carries its own identity apart from the entity's** (`RecordParty.identifier` vs
  `entityIdentifier`), which is what lets one person be on a record twice in two roles and never
  twice in one (`linkable-entities.ts`), and what lets removing a link leave the person in the
  directory. The remove control is the `unlink` glyph, never a waste bin, never the danger colour.
- **The tab's confirmation is an `ActionDialog`**, from the first commit — the attachments tab
  carries an allowance for its hand-composed one; this family does not.
- **`PARTIES_TAB_KEY`** is the agreement every record window imports, the twin of
  `ATTACHMENTS_TAB_KEY`.
