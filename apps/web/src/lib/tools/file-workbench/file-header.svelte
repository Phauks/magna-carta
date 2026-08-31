<script lang="ts">
  /*
   * Which file the readings below are about.
   *
   * It sits above the tab strip because it names the subject the tabs all read, and every tab reads
   * the same one. It carries the no-preview reason too: when there is nothing to draw, the picture
   * pane is not rendered at all — holding a large empty frame open for a picture that is not coming
   * is worse than a line saying why it is not coming.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { describeType, hasExtensionMismatch } from "./file-facts.ts";
  import { formatSize, type WorkbenchFile } from "./workbench-file.ts";

  let { file }: { file: WorkbenchFile } = $props();
</script>

<header class="flex flex-col gap-4">
  <h2 class="m-0 truncate text-sm font-semibold" title={file.name}>{file.name}</h2>
  <p class="m-0 flex flex-wrap items-center gap-8 text-xs text-text-muted">
    <span class="tabular-nums">{formatSize(file.sizeBytes)}</span>
    <span aria-hidden="true">·</span>
    <span>{describeType(file)}</span>
    {#if hasExtensionMismatch(file)}
      <Badge variant="danger">Name disagrees</Badge>
    {/if}
    {#if file.preview.kind === "none"}
      <span aria-hidden="true">·</span>
      <span>No preview: {file.preview.reason}</span>
    {/if}
  </p>
</header>
