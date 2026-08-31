/*
 * A description field that GROWS to what is written in it.
 *
 * The rule this serves is settled and it is not a nicety: the description is the line the client
 * reads on the bill, so the surface that captures it never clips it, never scrolls it sideways and
 * never hides it behind an ellipsis. A textarea does not do that by itself. Left alone it keeps the
 * height its `rows` asked for and scrolls its own content, which is exactly the outcome the rule
 * forbids: the reader sees three words of the sentence they are about to send a client.
 *
 * SO THE HEIGHT IS SET FROM THE CONTENT, ONCE PER CHANGE, AND INSTANTLY. It is a layout change, and
 * layout changes here are never animated; nothing in this file transitions a height.
 *
 * The measure is the two-step every auto-sizing field uses. Collapsing first is what lets the field
 * SHRINK again when text is deleted, because `scrollHeight` never reports less than the height the
 * element already has. The border is added back afterwards because a border-box element's
 * `scrollHeight` excludes it, and without that the last line loses its descenders.
 *
 * WHERE THIS BELONGS EVENTUALLY. Growing to fit is a property of the control rather than of the time
 * surface, so it is a candidate to move into the design system's Textarea as an option. It lives
 * here while exactly one surface needs it, so the shared component does not grow an option on the
 * strength of a single caller.
 */

function resize(field: HTMLTextAreaElement): void {
  const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight);
  const floor = Number.isFinite(lineHeight) ? lineHeight : 0;
  field.style.height = "auto";
  const border = field.offsetHeight - field.clientHeight;
  field.style.height = `${String(Math.max(floor, field.scrollHeight + border))}px`;
}

/**
 * Keep a textarea exactly as tall as what is written in it.
 *
 * `text` is read so a re-render that replaces the value from outside (an undo putting a description
 * back) re-measures too, rather than leaving the field the size the old text needed.
 */
export function autoSizeTextarea(text: string): (field: HTMLTextAreaElement) => () => void {
  return (field) => {
    void text;
    const onInput = (): void => resize(field);
    field.addEventListener("input", onInput);
    resize(field);
    return () => field.removeEventListener("input", onInput);
  };
}
