/**
 * The elements a caps label is legitimately rendered as.
 *
 * The set is closed on purpose. A label names what sits beneath it, so it is a `span` or a `p` in
 * running content, a `dt` in a definition list, or a heading where it genuinely heads a section —
 * and never a control, a `label` with a `for`, or a `legend`, each of which is a different question
 * with its own component.
 */
export type FieldLabelElement = "span" | "p" | "dt" | "h2" | "h3" | "h4";
