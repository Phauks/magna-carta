import { registerLineFor } from "./adr-file.mjs";

export const BEGIN = "<!-- BEGIN GENERATED REGISTER -->";
export const END = "<!-- END GENERATED REGISTER -->";

export function renderRegister(records) {
  return [...records]
    .sort((left, right) => left.number - right.number)
    .map(registerLineFor)
    .join("\n");
}

export function replaceRegister(documentMarkdown, registerBody) {
  const beginCount = documentMarkdown.split(BEGIN).length - 1;
  const endCount = documentMarkdown.split(END).length - 1;
  if (beginCount > 1 || endCount > 1) {
    throw new Error(
      "The document has ambiguous generated-register markers: the begin/end markers appear more than once (the register is duplicated). Reconstruct the file so exactly one marker pair remains before regenerating.",
    );
  }
  const begin = documentMarkdown.indexOf(BEGIN);
  const end = documentMarkdown.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error("The document is missing the generated-register markers");
  }
  const before = documentMarkdown.slice(0, begin + BEGIN.length);
  const after = documentMarkdown.slice(end);
  // Blank lines around the register keep Decision-Log.md a formatter fixed point: the markdown
  // formatter expects a blank line between the HTML-comment markers and the list.
  return `${before}\n\n${registerBody}\n\n${after}`;
}
