<script lang="ts">
  /*
   * ONE DOCUMENT, OPEN. The shell every opened file wears, whatever the file is.
   *
   * The owner's direction: a file that opens should open into the same thing every other file opens
   * into — the document named at the top, the way back to the matter it belongs to, and the rest of
   * the tab given over to whatever can actually show this kind of document. What differs between a
   * word-processing document, a portable document and a plain-text file is the INTERIOR and only the
   * interior; the frame around it is one frame, so a member learns it once.
   *
   * WHY IT IS A COMPONENT AND NOT A CONVENTION. The reader and the editor were two screens that each
   * assembled this frame for themselves, and they had already drifted: the same header written twice,
   * the same meta line written twice, the same failure branch written twice. Worse, both of them had
   * the same hole — the header was rendered INSIDE the branch that required a resolved file, so a
   * document that could not be resolved rendered no header, no way back, and in one case nothing
   * whatsoever. A member who opened a file the application could not open got an empty tab with no
   * title and no way out of it but the browser's own back button.
   *
   * SO THE SHELL IS UNCONDITIONAL. The header draws from whatever is known — the document's name
   * when the file resolved, the plain word when it did not — and the failure is stated in the BODY,
   * where the document would have been. There is no path through this component that renders
   * nothing: a tab that opened is a tab that says what it is.
   *
   * IT DRAWS NO CHROME OF ITS OWN ABOVE THE HEADER. The tab's chrome is the document group's layout
   * (routes/(document)/+layout.svelte), which is the app shell without the destination rail.
   */
  import { invalidateAll } from "$app/navigation";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import { formatDocumentSize, formatDocumentTimestamp } from "./document-presentation.ts";
  import type { Snippet } from "svelte";

  let {
    file = null,
    matter = undefined,
    failure = undefined,
    children,
  }: {
    /** The document, once it resolved. Null while it did not — the shell still draws. */
    file?: MatterFile | null;
    /** Its matter, for the way back's label. Absent costs the label its title and nothing else. */
    matter?: MatterRecord | undefined;
    /** What stood in the way of resolving the document, stated in the body with Retry beside it. */
    failure?: Failure | undefined;
    /** The interior: whatever can show THIS kind of document. */
    children: Snippet;
  } = $props();

  // The way back is the matter's own files, with this document revealed. It needs the file only for
  // the matter it names, so it survives everything except the file not resolving at all — and the
  // matter's title is a nicety on top of it, never a precondition.
  const filesBack = $derived(
    file === null ? undefined : matterFilesBack(file.matterId, matter?.title ?? "Files", file.id),
  );
</script>

<svelte:head>
  <title>{file === null ? "Document" : file.name} · Magna Carta</title>
</svelte:head>

<!-- The working-surface arrangement: a full-height flex column, so the interior below can take
     exactly the remaining viewport height. The header is flex-none so it never gives way. -->
<div class="flex min-h-full flex-col">
  <ScreenHeader
    title={file === null ? "Document" : file.name}
    back={filesBack}
    class="mb-24 flex-none"
  >
    {#snippet meta()}
      {#if file !== null}
        <span>Version {file.versionNumber}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentSize(file.sizeBytes)}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentTimestamp(file.updatedAt)}</span>
      {/if}
    {/snippet}
  </ScreenHeader>

  <!-- Edge to edge: the horizontal margins cancel the work canvas's padding, so the interior runs
       to the canvas's edges like the file manager's list does. -->
  <FullHeightSection class="-mx-24">
    {#if failure !== undefined}
      <div class="p-24">
        <FailureNotice
          {failure}
          subject="The document"
          fallback="The document could not be read."
          whenSilent="Nothing answered when the document was read."
          onRetry={() => void invalidateAll()}
        />
      </div>
    {:else}
      {@render children()}
    {/if}
  </FullHeightSection>
</div>
