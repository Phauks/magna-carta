/**
 * The elements a caps label is legitimately rendered as.
 *
 * The set is closed on purpose, and each member earns its place by being what some real document
 * structure requires: `span` and `p` in running content, `dt` for the term in a definition list,
 * `figcaption` for the caption of a figure, a heading where the label genuinely heads a section,
 * and `div` for the one case none of those fit — a label whose own content is flow rather than
 * text, such as a name with an information control beside it.
 *
 * What is deliberately absent: `label`, which names a form control and carries a `for` (that is the
 * Label component's job), and anything interactive. This names; it does not act.
 */
export type FieldLabelElement = "span" | "p" | "div" | "dt" | "figcaption" | "h2" | "h3" | "h4";
