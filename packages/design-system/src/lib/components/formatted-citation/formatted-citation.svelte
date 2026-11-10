<script lang="ts">
  /*
   * FormattedCitation — one legal citation, as the citation engine formatted it, with a Copy
   * control. Every surface that shows a citation renders it through here, so italics are the
   * runs' own (never markup assembled by a caller) and Copy puts both the styled text and the plain
   * text on the clipboard: pasted into a brief it keeps its italics, pasted into an email it reads
   * cleanly.
   *
   * `incomplete` marks a citation with required details still missing; the text is shown as it
   * stands, in the muted register, so it is never mistaken for one ready to file.
   */
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import type { HTMLAttributes } from "svelte/elements";
  import Button from "../button/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { copyText, type CopyResult } from "../failure-details/copy-text.ts";
  import { citationHtml, type FormattedCitationRun } from "./citation-html.ts";

  let {
    runs,
    incomplete = false,
    copyable = true,
    copyLabel = "Copy",
    class: className,
    ...restProps
  }: HTMLAttributes<HTMLDivElement> & {
    runs: readonly FormattedCitationRun[];
    incomplete?: boolean;
    copyable?: boolean;
    /** The Copy control's accessible name, e.g. "Copy Full Citation". */
    copyLabel?: string;
  } = $props();

  const plainText = $derived(runs.map((run) => run.text).join(""));
  let result = $state<CopyResult | null>(null);

  async function copy(): Promise<void> {
    result = await copyRich();
    setTimeout(() => (result = null), 1600);
  }

  // Styled and plain text together where the browser allows it, so a paste into a brief keeps its
  // italics; otherwise the plain text by the shared route, which reports a refusal honestly.
  async function copyRich(): Promise<CopyResult> {
    if (typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([citationHtml(runs)], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
        return "copied";
      } catch {
        // Fall through to the plain-text route.
      }
    }
    return copyText(plainText);
  }
</script>

<div class={mergeClasses("mc-formatted-citation", className)} data-incomplete={incomplete || undefined} {...restProps}>
  <p class="mc-formatted-citation-text min-w-0 flex-1">
    {#each runs as run, index (index)}{#if run.italic}<i>{run.text}</i>{:else}{run.text}{/if}{/each}
  </p>
  {#if copyable}
    <Button variant="ghost" size="sm" onclick={copy} aria-label={copyLabel} disabled={plainText === ""}>
      {#if result === "copied"}<Check class="size-16" aria-hidden="true" />Copied{:else if result === "failed"}Copy Failed{:else}<Copy
          class="size-16"
          aria-hidden="true"
        />Copy{/if}
    </Button>
  {/if}
</div>
