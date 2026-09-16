/*
 * Service marks — the outside services' own brand marks, self-hosted and unaltered.
 *
 * Kept apart from everything else in this package on purpose. The rest of the design system is our
 * own vocabulary, and its icon rule is absolute: every glyph is Lucide, none is drawn here. What
 * lives in this directory is not ours at all — each file is a third party's published mark, shown
 * only to identify the service a control links to (nominative use). Adding one is not a design
 * decision, it is a compliance step with a register entry:
 * docs/conventions/third-party-trademarks.md.
 */
import GithubMark from "./github-mark.svelte";

export { GithubMark };
