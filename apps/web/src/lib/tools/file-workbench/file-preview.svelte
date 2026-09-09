<script lang="ts">
  /*
   * The file itself, where there is something to draw.
   *
   * Rendered only when there IS a picture: a pane held open for an archive, an executable or an
   * encrypted document is dead space, and the readings want that width more. Which file this is,
   * and why some files have no picture, is said by the header above the readings.
   *
   * What is drawn is drawn narrowly. An image goes to the image decoder and to nothing else; text
   * is rendered as text. Neither path interprets markup or runs anything. A document preview needs
   * the cookieless delivery host, which needs the file uploaded, and this host does not upload.
   */
  import type { PreviewState } from "./workbench-file.ts";

  let { preview, name }: { preview: PreviewState; name: string } = $props();
</script>

<div class="flex h-full min-h-0 flex-col p-20">
  {#if preview.kind === "image"}
    <div
      class="mc-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border border-border-default bg-surface-sunken p-16"
    >
      <img src={preview.objectUrl} alt="The contents of {name}" class="max-h-full object-contain" />
    </div>
  {:else if preview.kind === "text"}
    <pre
      class="mc-scrollbar m-0 min-h-0 flex-1 overflow-auto rounded-md border border-border-default bg-surface-sunken p-16 font-mono text-xs whitespace-pre-wrap">{preview.excerpt}</pre>
  {/if}
</div>
