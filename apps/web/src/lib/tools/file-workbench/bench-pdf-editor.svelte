<script lang="ts">
  /*
   * The PDF Editor, opened on a file from the bench.
   *
   * The same tools the matter's PDF Editor has, over the same body (`pdf-editor-tabs.svelte`), with
   * two ends changed by the subject it is handed (`$lib/pdf-editor/editor-subject.ts`): the bytes
   * come from the bench's own copy, and whatever a tool makes goes back on the bench as a new file.
   * Nothing is added to a matter. Bates needs a matter's register, so on a bench file its tab says
   * so instead of numbering.
   *
   * It is drawn by the workbench's own route, over the bench rather than on a screen of its own: the
   * bench's files live in this page and nowhere else, so leaving the route would clear the very file
   * being edited. The bench stays mounted underneath, and Back (the browser's, or the way back
   * above the title) returns to it as it was left, with the new files on it.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import { FILE_WORKBENCH_BACK } from "$lib/screen/screen-header.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { benchSubject } from "$lib/pdf-editor/editor-subject.ts";
  import PdfEditorTabs from "$lib/pdf-editor/pdf-editor-tabs.svelte";
  import Absence from "./parts/absence.svelte";
  import { formatSize, type WorkbenchFile } from "./workbench-file.ts";

  let {
    file,
    tool = $bindable("pages"),
    onAddFiles,
  }: {
    /** The bench file being edited, or null when it has been taken off the bench. */
    file: WorkbenchFile | null;
    tool?: string;
    /** Put what a tool made on the bench. */
    onAddFiles: (files: readonly File[]) => void;
  } = $props();

  const subject = $derived(file === null ? null : benchSubject(file, (made) => onAddFiles([made])));
</script>

<svelte:head>
  <title>{file === null ? "PDF Editor" : `Edit ${file.name}`} · Magna Carta</title>
</svelte:head>

{#if file === null || subject === null}
  <ScreenHeader title="PDF Editor" back={FILE_WORKBENCH_BACK} class="mb-16" />
  <Absence kind="not-applicable" reason="This file is no longer on the bench." />
{:else}
  <div class="flex min-h-full flex-col">
    <ScreenHeader title={file.name} back={FILE_WORKBENCH_BACK} class="mb-16 flex-none">
      {#snippet meta()}
        <span>On the Bench</span>
        <Masthead.MetaSeparator />
        <span>{formatSize(file.sizeBytes)}</span>
      {/snippet}
    </ScreenHeader>

    <PdfEditorTabs {subject} bind:tool reopenKey={file.id} onSaved={() => {}} />
  </div>
{/if}
