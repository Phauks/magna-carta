// The detector behind `pnpm run lint:modal-reflow`, kept apart from the walk so it can be tested
// against source text rather than against the tree. The rule itself, and why it is this rule, is
// written at the top of index.mjs.

/** The shells that make a file a modal surface. A page that folds a section is not one of these. */
const MODAL_SHELLS = [
  "<ActionDialog",
  "<AlertDialog",
  "<Dialog.Content",
  "<Sheet.Content",
  "<RecordWindow",
];

const ARIA_EXPANDED = /aria-expanded=\{([^}]+)\}/g;
/** The escape, matching the house form used by the off-token sweep. */
const ALLOW_COMMENT = /(?:\/\*|<!--)\s*fitness-allow:\s*\S/;

/** Every line index covered by a `<Shell ...> … </Shell>` pair, and by the snippets it is handed. */
function modalLineIndexes(lines) {
  const inside = new Set();
  const snippetProps = new Set();
  for (const shell of MODAL_SHELLS) {
    const tag = shell.slice(1);
    const closing = `</${tag.split(" ")[0]}>`;
    for (const [start, line] of lines.entries()) {
      if (!line.includes(shell)) continue;
      // The shell's own range, to its closing tag or to the end of the file if it has none.
      let end = lines.length - 1;
      for (let at = start; at < lines.length; at += 1) {
        if (lines[at].includes(closing)) {
          end = at;
          break;
        }
      }
      for (let at = start; at <= end; at += 1) {
        inside.add(at);
        // Every bare word inside the shell's range. Cross-referenced below against the file's own
        // snippet names, so `context={details}` and a tab list's `content: record` are both found:
        // a record window hands its snippets over inside an array of objects, not as props.
        for (const match of lines[at].matchAll(/\b[A-Za-z_]\w*\b/g)) snippetProps.add(match[0]);
      }
    }
  }
  // The snippets those props name, wherever in the file they are written.
  for (const [start, line] of lines.entries()) {
    const declared = /\{#snippet\s+(\w+)/.exec(line);
    if (declared === null || !snippetProps.has(declared[1])) continue;
    let depth = 0;
    for (let at = start; at < lines.length; at += 1) {
      inside.add(at);
      depth += (lines[at].match(/\{#snippet\b/g) ?? []).length;
      depth -= (lines[at].match(/\{\/snippet\}/g) ?? []).length;
      if (depth <= 0 && at > start) break;
    }
  }
  return inside;
}

/** Every reveal-in-place inside a modal in one file's source. */
export function modalReflowFindings(text) {
  if (!MODAL_SHELLS.some((shell) => text.includes(shell))) return [];
  const lines = text.split("\n");
  const inside = modalLineIndexes(lines);
  // What a shell's own `open` is bound to: the trigger that names it is opening a window, not
  // expanding one. `bind:open` on its own is the shorthand for a state called `open`.
  const boundToOpen = new Set(
    [...text.matchAll(/bind:open(?:=\{(\w+)\})?/g)].map((match) => match[1] ?? "open"),
  );
  const findings = [];
  for (const [index, line] of lines.entries()) {
    if (!inside.has(index) || ALLOW_COMMENT.test(line)) continue;
    for (const match of line.matchAll(ARIA_EXPANDED)) {
      const expression = match[1].trim();
      if (boundToOpen.has(expression)) continue;
      findings.push({ line: index + 1, expression });
    }
  }
  return findings;
}
