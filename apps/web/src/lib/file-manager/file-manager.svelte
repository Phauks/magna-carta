<script lang="ts">
  /*
   * The matter's file manager: the folder rail, the file list, and the details panel, in three
   * panes a person can resize.
   *
   * Both inner edges drag, identically. The panes are the design system's Resizable (paneforge),
   * which brings the drag, the keyboard resize and the separator semantics with it — this screen
   * only says where the edges are and how small each pane may get.
   *
   * Nothing here blocks a file. A file that failed a scan is shown where its owner put it, marked,
   * and remains selectable and downloadable: refusing to show it is the greater hazard.
   */
  import * as Resizable from "@magna-carta/design-system/resizable";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Plus from "@lucide/svelte/icons/plus";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import {
    listMatterDocuments,
    type DocumentSummary,
  } from "$lib/documents/document-api.ts";
  import { documentsNewestFirst, problemGuidance } from "$lib/documents/document-presentation.ts";
  import DocumentDetailPanel from "$lib/documents/document-detail-panel.svelte";
  import NewDocumentDialog from "$lib/documents/new-document-dialog.svelte";
  import {
    createFolder,
    deleteFile,
    downloadUrl,
    listMatterFolders,
    patchFile,
    type FolderSummary,
  } from "./folder-api.ts";
  import { ancestorIds, pathTo } from "./folder-tree.ts";
  import FolderRail from "./folder-rail.svelte";
  import FileList from "./file-list.svelte";

  let { matterId }: { matterId: string } = $props();

  let folders = $state<readonly FolderSummary[]>([]);
  let documents = $state<readonly DocumentSummary[] | null>(null);
  let loadFailure = $state<string | null>(null);
  let currentFolderId = $state<string | null>(null);
  let expandedIds = $state<string[]>([]);
  let selection = $state<Set<string>>(new Set());
  let activeId = $state<string | null>(null);
  let createOpen = $state(false);
  let actionFailure = $state<string | null>(null);
  // Bumped to force a re-read after something lands or changes.
  let reloadToken = $state(0);

  const activeDocument = $derived(
    documents === null ? null : (documents.find((document) => document.id === activeId) ?? null),
  );
  /**
   * Home first, then the ancestors, then here. The trail is the folder's real path. The design
   * system's Breadcrumb takes hrefs, and moving between folders here changes state rather than the
   * address, so the trail is buttons — the same shape, doing the thing this screen actually does.
   */
  const trail = $derived([
    { id: null as string | null, label: "Home" },
    ...pathTo(folders, currentFolderId).map((folder) => ({
      id: folder.id as string | null,
      label: folder.name,
    })),
  ]);
  const inThisFolder = $derived(
    documents === null
      ? []
      : documents.filter((document) => document.folderId === currentFolderId),
  );

  $effect(() => {
    const token = reloadToken;
    let cancelled = false;
    void (async () => {
      void token;
      const [fileResult, folderResult] = await Promise.all([
        listMatterDocuments(fetch, matterId),
        listMatterFolders(fetch, matterId),
      ]);
      if (cancelled) return;
      if (fileResult.kind === "ok") {
        documents = documentsNewestFirst(fileResult.value.data);
        loadFailure = null;
      } else {
        documents = [];
        loadFailure =
          fileResult.kind === "problem"
            ? problemGuidance(fileResult.problem).message
            : "Nothing answered. The record itself is unaffected.";
      }
      // A folder read that fails is not the same failure: the files are still readable and still
      // listed, they just cannot be navigated by folder. Saying "the files could not be read" there
      // would be false.
      folders = folderResult.kind === "ok" ? folderResult.value.data : [];
    })();
    return () => {
      cancelled = true;
    };
  });

  // Selecting a folder deep in the tree has to reveal it, or the selection lands out of sight.
  $effect(() => {
    const needed = ancestorIds(folders, currentFolderId);
    const missing = needed.filter((id) => !expandedIds.includes(id));
    if (missing.length > 0) expandedIds = [...expandedIds, ...missing];
  });

  // Changing folder clears the selection: the rows it named are not on screen any more, and a
  // Delete that acts on files the person can no longer see is the worst kind of surprise.
  $effect(() => {
    void currentFolderId;
    selection = new Set();
    activeId = null;
  });

  async function makeFolder(): Promise<void> {
    const name = globalThis.prompt("Name for the new folder");
    if (name === null || name.trim() === "") return;
    const result = await createFolder(
      fetch,
      { matterId, parentFolderId: currentFolderId, name: name.trim() },
      crypto.randomUUID(),
    );
    if (result.kind === "ok") reloadToken += 1;
  }

  function reload(): void {
    reloadToken += 1;
  }

  async function renameFile(document: DocumentSummary): Promise<void> {
    const stem = document.name.includes(".")
      ? document.name.slice(0, document.name.lastIndexOf("."))
      : document.name;
    const extension = document.name.slice(stem.length);
    // The extension is not offered for editing. Changing it by accident renames the file into
    // something its own application will not open, and that has been raised as a critical error.
    const chosen = globalThis.prompt(`Rename "${document.name}"`, stem);
    if (chosen === null || chosen.trim() === "" || chosen.trim() === stem) return;
    const next = chosen.trim().endsWith(extension) ? chosen.trim() : chosen.trim() + extension;
    const result = await patchFile(fetch, document.id, { name: next });
    if (result.kind === "ok") reload();
    else actionFailure = "That file could not be renamed.";
  }

  async function removeFiles(ids: readonly string[]): Promise<void> {
    const what = ids.length === 1 ? "this file" : `these ${ids.length} files`;
    // Soft delete: the wording says what actually happens rather than implying destruction.
    if (!globalThis.confirm(`Delete ${what}? It moves out of the list and stays recoverable.`)) return;
    const results = await Promise.all(ids.map((id) => deleteFile(fetch, id)));
    if (results.some((result) => result.kind !== "ok")) {
      actionFailure = ids.length === 1 ? "That file could not be deleted." : "Some of those files could not be deleted.";
    }
    selection = new Set();
    activeId = null;
    reload();
  }

  function download(ids: readonly string[]): void {
    // Each file is fetched from its own signed URL. A multi-file bundle is a server-side job and is
    // not built, so asking for several opens several rather than pretending to zip them here.
    for (const id of ids) globalThis.open(downloadUrl(id), "_blank", "noopener");
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex items-center gap-12 border-b border-border-default px-12 py-8">
    <nav class="flex min-w-0 items-center gap-2 overflow-x-auto" aria-label="Folder path">
      {#each trail as crumb, index (crumb.id ?? "root")}
        {#if index > 0}
          <ChevronRight class="size-12 shrink-0 text-text-subtle" aria-hidden="true" />
        {/if}
        <Button
          variant="ghost"
          size="sm"
          aria-current={index === trail.length - 1 ? "page" : undefined}
          onclick={() => (currentFolderId = crumb.id)}
        >
          {crumb.label}
        </Button>
      {/each}
    </nav>
    <Button size="sm" class="ml-auto" onclick={() => (createOpen = true)}>
      <Plus class="size-16" aria-hidden="true" />
      Add a document
    </Button>
  </div>

  {#if actionFailure !== null}
    <div class="px-16 pt-12">
      <Alert.Root variant="warning">
        <Alert.Title>That did not go through.</Alert.Title>
        <Alert.Description>{actionFailure}</Alert.Description>
      </Alert.Root>
    </div>
  {/if}

  {#if loadFailure !== null}
    <div class="p-16">
      <Alert.Root variant="warning">
        <Alert.Title>The files could not be read.</Alert.Title>
        <Alert.Description>{loadFailure}</Alert.Description>
      </Alert.Root>
    </div>
  {:else if documents === null}
    <div class="p-16"><Skeleton class="h-64 w-full" /></div>
  {:else}
    <Resizable.PaneGroup direction="horizontal" autoSaveId="matter-files-panes">
      <Resizable.Pane defaultSize={20} minSize={12} maxSize={36}>
        <FolderRail {folders} bind:currentFolderId bind:expandedIds onNewFolder={makeFolder} />
      </Resizable.Pane>
      <Resizable.Handle withHandle />
      <Resizable.Pane defaultSize={54} minSize={30}>
        <FileList
          documents={inThisFolder}
          bind:selection
          bind:activeId
          onOpen={(document) => (activeId = document.id)}
          onRename={renameFile}
          onDelete={removeFiles}
          onDownload={download}
        />
      </Resizable.Pane>
      <Resizable.Handle withHandle />
      <Resizable.Pane defaultSize={26} minSize={18} maxSize={44}>
        <div class="h-full overflow-y-auto p-12">
          {#if activeDocument === null}
            <p class="text-sm text-text-muted">
              Select a file: its details, its safety history and its versions live here while the
              list stays in reach.
            </p>
          {:else}
            <DocumentDetailPanel document={activeDocument} onVersionSaved={reload} />
          {/if}
        </div>
      </Resizable.Pane>
    </Resizable.PaneGroup>
  {/if}
</div>

<NewDocumentDialog bind:open={createOpen} {matterId} onCreated={reload} />
