/*
 * What an entity is to the surfaces that name one.
 *
 * The directory holds two kinds of record and nothing else — a person, or an organization — and every
 * surface that names an entity has to say which of the two it is showing, because "Meridian" is a
 * company on one file and a family on the next. The kind is a fact the caller supplies, never a guess
 * from the name: nothing here, or anywhere the mark is rendered, infers what an entity is from what it
 * is called.
 */

/** The two sides of the directory. Closed on purpose; a third kind is a reviewed change to this file. */
export type EntityKind = "person" | "organization";

/**
 * How large the mark renders.
 *
 * `default` is a table cell or a list row; `sm` is a chip standing inside a field or beside a name,
 * where the mark must not out-weigh the control it sits in. A record's own heading is not a size of
 * this component: the masthead names the record, and this mark is for naming one from somewhere else.
 */
export type EntityIdentitySize = "default" | "sm";
