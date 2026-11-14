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
  import { page } from "$app/state";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import { queryFromUrl } from "$lib/matters/query-from-url.ts";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FilePlus2 from "@lucide/svelte/icons/file-plus-2";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import Upload from "@lucide/svelte/icons/upload";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");
  // The folder the upload tray's "Open folder" names: `?folder=<id>`, beside the `entry` every deep
  // link carries. Read from the address so a new one lands without remounting.
  const folderFromUrl = $derived(page.url.searchParams.get("folder"));

  /*
   * The matter header's New is the surface's one create control, and it is a MENU here: three
   * ways something new lands in the folder the reader is standing in. Views with no current folder
   * (search results, deleted files, history, inside an archive) keep the control present and
   * disabled with the reason, so the header never changes shape under the pointer — the file
   * manager's own ruling, carried up to the band. The manager exports the three actions and the
   * refusal rather than growing a button of its own (create-action.svelte.ts).
   */
  let fileManager = $state<ReturnType<typeof FileManager> | null>(null);
  claimMatterCreate("files", () => {
    const refusal = isSample
      ? SAMPLE_MATTER_REFUSAL
      : fileManager === null
        ? "The files are not on screen, so nothing can be added to them."
        : fileManager.createRefusal();
    return {
      title: "Add a document, a folder or an upload to the folder you are in.",
      refusal,
      choices: [
        { label: "New Document", icon: FilePlus2, run: () => fileManager?.newDocument() },
        { label: "New Folder", icon: FolderPlus, run: () => fileManager?.newFolder() },
        { label: "Upload Files", icon: Upload, run: () => fileManager?.upload() },
      ],
    };
  });
</script>

{#if isSample}
  <section class="flex flex-col gap-16">
    <Alert.Root variant="info">
      <Alert.Title>This Is a Sample Matter</Alert.Title>
      <Alert.Description>
        This is a sample matter for previewing screens. It has no files. Open one of the firm's matters to use it.
      </Alert.Description>
    </Alert.Root>
  </section>
{:else}
  <!-- The remaining-height frame every working surface uses, plus this one's own edge-to-edge
       treatment: the horizontal margins cancel the work canvas's padding and the top one cancels
       the layout's gap below the section strip, so the surface runs to the edges and the toolbar
       sits directly under the tabs. -->
  <FullHeightSection class="-mx-24 -mt-24">
    <FileManager
      bind:this={fileManager}
      matterId={matter.id}
      matterTitle={matter.title}
      revealFileId={entryFromUrl()}
      revealFolderId={folderFromUrl === null || folderFromUrl === "" ? null : folderFromUrl}
      searchQuery={queryFromUrl()}
    />
  </FullHeightSection>
{/if}
