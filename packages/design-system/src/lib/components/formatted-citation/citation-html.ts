/*
 * A citation's runs as the HTML a word processor pastes with its italics intact. The design system
 * takes runs rather than the citation engine's own type so it does not depend on the engine; any
 * `{ text, italic }` list fits.
 */
export interface FormattedCitationRun {
  readonly text: string;
  readonly italic: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function citationHtml(runs: readonly FormattedCitationRun[]): string {
  return runs
    .map((run) => (run.italic ? `<i>${escapeHtml(run.text)}</i>` : escapeHtml(run.text)))
    .join("");
}
