<script lang="ts">
  /*
   * The matter's files. The whole loop on one screen: the folder tree on the left, the files in the
   * folder being shown, and the selected file's details on the right, each pane resizable.
   *
   * The one exception is a SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are
   * reviewed against), which has no firm behind it and therefore no files to read. That case says
   * so rather than showing an empty tree, because "no files" and "not a real matter" are different
   * facts and only one of them is a problem.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import FileManager from "$lib/file-manager/file-manager.svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");
</script>

{#if isSample}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="info">
      <Alert.Title>This Is a Sample Matter</Alert.Title>
      <Alert.Description>
        It exists so the matter screens stay reviewable at a stable address; there is no firm record
        behind it, so it holds no files and nothing can be added to it. Open one of the firm's own
        matters to use this surface.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <!-- The file area takes the remaining height and keeps it, so the screen does not reflow as rows
       arrive, as a filter narrows them, or as an empty state replaces them. -->
  <div class="flex h-full min-h-0 flex-col">
    <FileManager matterId={matter.id} />
  </div>
{/if}
