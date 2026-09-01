/*
 * Putting text on the clipboard, and admitting it when that fails.
 *
 * THE HONEST FAILURE IS THE POINT. `navigator.clipboard` is unavailable on an insecure origin,
 * refused when the document is not focused, and blocked outright by some managed browser policies —
 * all of which reject rather than crash. A button that swallows that and shows "Copied" has told a
 * person their error report is on the clipboard when it is not, and they will paste an empty message
 * into a support thread and wait. So every path returns what actually happened, and the one caller
 * renders the difference.
 *
 * The fallback is the selection-and-`execCommand` route. It is deprecated and it is the only thing
 * that works where the async API is refused, which is exactly when a copy button matters most.
 */

export type CopyResult = "copied" | "failed";

function copyByExecCommand(text: string): CopyResult {
  if (typeof document === "undefined") return "failed";
  const holder = document.createElement("textarea");
  holder.value = text;
  // Off-screen rather than hidden: a `display: none` element cannot be selected, and an element the
  // page can see would flash. `readonly` stops a mobile keyboard appearing for the moment it exists.
  holder.setAttribute("readonly", "");
  holder.style.position = "fixed";
  holder.style.insetBlockStart = "-9999px";
  holder.style.insetInlineStart = "-9999px";
  document.body.appendChild(holder);
  const selection = document.getSelection();
  const previousRange =
    selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  try {
    holder.select();
    holder.setSelectionRange(0, text.length);
    return document.execCommand("copy") ? "copied" : "failed";
  } catch {
    return "failed";
  } finally {
    holder.remove();
    // Give the reader their own selection back — they may have been part-way through selecting the
    // very block this button copies.
    if (previousRange !== null && selection !== null) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }
}

/** Copy `text`, preferring the async clipboard and falling back where it is refused. */
export async function copyText(text: string): Promise<CopyResult> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // Refused, not absent. The fallback below works in several of the cases that land here.
    }
  }
  return copyByExecCommand(text);
}
