<script lang="ts">
  /*
   * The matter's file manager: the folder rail, the file list, and the details panel, in three
   * panes a reader can resize from either inner edge.
   *
   * ONE TABLE. Sorting, the in-header per-column filters, show/hide, drag-reorder, pinning, resize
   * with double-click fit, the selection model, the pinned block, the filtered-empty state and the
   * counts strip are all the product's one grid. This file declares which rows and which columns
   * each view wants, renders the cells, and decides none of that behaviour — a gap between this
   * table and any other table in the product would be a defect by definition.
   *
   * NOTHING IS EVER BLOCKED. A file the scanner flagged is shown where its owner put it, marked,
   * selectable, and downloadable once acknowledged. A flag is a note, not a gate: refusing to show
   * somebody their own document is the greater hazard, and it is the hazard this screen exists to
   * avoid.
   *
   * WHAT IS NOT SERVED STILL RENDERS. Deleted Files, the changelog and Search Results are real rows
   * in the rail and real views on this table; each says, once and plainly, what its arrival waits
   * on. Removing them would hide the shape of the surface and move the rows around every time the
   * reader changed view.
   */
  import * as ContextMenu from "@magna-carta/design-system/context-menu";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Resizable from "@magna-carta/design-system/resizable";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import FolderGlyph from "@magna-carta/design-system/folder-glyph";
  import FolderTree from "@magna-carta/design-system/folder-tree";
  import Input from "@magna-carta/design-system/input";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { statusEntry } from "@magna-carta/design-system/status-register";
  import type {
    FolderColorName,
    FolderIconName,
    FolderTreeMenuTarget,
    FolderTreeNode,
    FolderTreeView,
  } from "@magna-carta/design-system/folder-tree";
  import Download from "@lucide/svelte/icons/download";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import FileArchive from "@lucide/svelte/icons/file-archive";
  import FileSearch from "@lucide/svelte/icons/file-search";
  import History from "@lucide/svelte/icons/history";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Upload from "@lucide/svelte/icons/upload";
  import { problemGuidance } from "$lib/documents/document-presentation.ts";
  import {
    createFolder,
    deleteFolder as deleteFolderRequest,
    patchFile,
    patchFolder,
    listMatterFolders,
    deleteFile,
    writeKey,
    type FolderSummary,
  } from "./folder-api.ts";
  import {
    createDocumentType,
    fileDownloadUrl,
    listArchiveEntries,
    listDeletedFiles,
    listDocumentTypes,
    listFileHistory,
    listFileVersions,
    listMatterFiles,
    restoreFile,
    verifyFileIntegrity,
    type ArchiveEntry,
    type DeletedFileSummary,
    type DocumentTypeSummary,
    type FileHistoryEntry,
    type IntegrityVerification,
    type MatterFile,
    type MatterFileVersion,
  } from "./matter-file-api.ts";
  import {
    archiveLevelRows,
    archivePathSegments,
    type ArchiveRow,
  } from "./archive-browse.ts";
  import {
    uploadIntoFolder,
    UPLOAD_STAGE_NARRATION,
    type UploadOutcome,
    type UploadProgressItem,
  } from "./file-upload.ts";
  import {
    MatterFileIndex,
    fileKey,
    folderKey,
    type FileManagerRow,
    folderAggregate,
  } from "./file-rows.ts";
  import {
    archiveColumns,
    browseColumns,
    deletedColumns,
    historyColumns,
    locatedColumns,
    safetyKeyOf,
    fileExtension,
  } from "./file-columns.ts";
  import {
    collidingSibling,
    committedRename,
    disambiguated,
    displayName,
    renameConflictMessage,
    renameFieldValue,
    splitName,
  } from "./file-names.ts";
  import { countPhrase } from "./file-manager-vocabulary.ts";
  import {
    allIssues,
    issueKey,
    issueReportText,
    issuesOnFile,
    type Issue,
  } from "./file-analysis.ts";
  import { capability, waitingReason } from "./file-manager-availability.ts";
  import { backgroundMenu, rowMenu, type FileMenuCommand } from "./file-menu-model.ts";
  import { FileManagerState, type FileManagerView } from "./file-manager-state.svelte.ts";
  import FileManagerToolbar from "./file-manager-toolbar.svelte";
  import FileManagerFooter from "./file-manager-footer.svelte";
  import FileContextMenu from "./file-context-menu.svelte";
  import FileIconGrid from "./file-icon-grid.svelte";
  import FileInspector from "./file-inspector.svelte";
  import FolderDeleteDialog from "./folder-delete-dialog.svelte";
  import RestoreFileDialog from "./restore-file-dialog.svelte";
  import UploadDestinationDialog from "./upload-destination-dialog.svelte";
  import SafetyMark from "./safety-mark.svelte";
  import DocumentTypeMenu from "./document-type-menu.svelte";

  let { matterId, matterTitle }: { matterId: string; matterTitle: string } = $props();

  const manager = new FileManagerState();

  // --- the matter's files and folders ------------------------------------------------------------

  let folders = $state<readonly FolderSummary[]>([]);
  let files = $state<readonly MatterFile[] | null>(null);
  let documentTypes = $state<readonly DocumentTypeSummary[]>([]);
  let loadFailure = $state<string | null>(null);
  let actionFailure = $state<string | null>(null);
  let reloadToken = $state(0);

  const loading = $derived(files === null);
  const index = $derived(new MatterFileIndex(folders, files ?? []));

  $effect(() => {
    void reloadToken;
    let cancelled = false;
    void (async () => {
      const [fileResult, folderResult, typeResult] = await Promise.all([
        listMatterFiles(fetch, matterId),
        listMatterFolders(fetch, matterId),
        listDocumentTypes(fetch),
      ]);
      if (cancelled) return;
      if (fileResult.kind === "ok") {
        files = fileResult.value.data;
        loadFailure = null;
      } else {
        files = [];
        loadFailure =
          fileResult.kind === "problem"
            ? problemGuidance(fileResult.problem).message
            : "Nothing answered. The record itself is unaffected.";
      }
      // A folder read that fails is a different failure: the files are still readable and still
      // listed, they just cannot be navigated by folder. Saying "the files could not be read" would
      // be false.
      folders = folderResult.kind === "ok" ? folderResult.value.data : [];
      // The firm's own vocabulary. An empty catalogue is genuinely empty, never padded.
      documentTypes = typeResult.kind === "ok" ? typeResult.value.data : [];
    })();
    return () => {
      cancelled = true;
    };
  });

  function reload(): void {
    reloadToken += 1;
  }

  // A folder that has gone must not sit in the Back stack waiting to strand somebody in a place
  // that no longer exists.
  $effect(() => {
    const present = new Set(folders.map((folder) => folder.id));
    const missing = new Set<string>();
    if (manager.currentFolderId !== null && !present.has(manager.currentFolderId)) {
      missing.add(manager.currentFolderId);
    }
    if (missing.size > 0) manager.forgetMissingFolders(missing);
  });

  const documentTypeName = (documentTypeId: string | null): string =>
    documentTypeId === null
      ? ""
      : (documentTypes.find((type) => type.id === documentTypeId)?.name ?? "");

  /**
   * Who created a file. The listing carries no author, so this answers honestly with nothing rather
   * than with "You" — a name the record does not hold is not a name this column may invent.
   */
  const createdBy = (): string => "";

  // --- the rows each view shows -------------------------------------------------------------------

  /*
   * File Analysis. An issue is per file per kind, so a judgement to ignore one says nothing about
   * the others on the same file. The judgements are held for this visit: nothing serves them yet,
   * and the view says so rather than implying they will be there tomorrow.
   */
  let ignoredIssues = $state<ReadonlySet<string>>(new Set());
  let showingIgnored = $state(false);

  const everyIssue = $derived(allIssues(files ?? []));
  const openIssues = $derived(everyIssue.filter((issue) => !ignoredIssues.has(issueKey(issue))));
  const ignoredIssueList = $derived(
    everyIssue.filter((issue) => ignoredIssues.has(issueKey(issue))),
  );
  /*
   * The issues the view is currently showing: the open set, or the ignored set when asked. No
   * severity or kind narrowing up here — the Safety column already filters, and a second set of
   * filters above the table said the same thing twice.
   */
  const shownIssues = $derived.by((): readonly Issue[] =>
    showingIgnored ? ignoredIssueList : openIssues,
  );
  const analysisFileIds = $derived(new Set(shownIssues.map((issue) => issue.fileId)));

  const rows = $derived.by((): FileManagerRow[] => {
    if (files === null) return [];
    if (manager.view === "analysis") {
      return files
        .filter((file) => analysisFileIds.has(file.id))
        .map((file) => ({ kind: "file", key: fileKey(file.id), file }) as const);
    }
    if (manager.view === "results") {
      const query = manager.searchQuery.trim().toLowerCase();
      if (query === "") return [];
      return files
        .filter((file) => file.name.toLowerCase().includes(query))
        .map((file) => ({ kind: "file", key: fileKey(file.id), file }) as const);
    }
    // Deleted Files and the changelog have no feed to read, so their tables are honestly empty
    // rather than showing this folder's rows under somebody else's heading.
    if (manager.view === "deleted" || manager.view === "history") return [];
    return [
      ...index
        .childrenOf(manager.currentFolderId)
        .map((folder) => ({ kind: "folder", key: folderKey(folder.id), folder }) as const),
      ...index
        .filesIn(manager.currentFolderId)
        .map((file) => ({ kind: "file", key: fileKey(file.id), file }) as const),
    ];
  });

  const columnContext = $derived({
    index,
    hideExtensions: manager.hideExtensions,
    documentTypeName,
    createdBy,
  });

  const grid = DataTable.createDataTableGrid<FileManagerRow>({
    columns: () =>
      manager.view === "browse" ? browseColumns(columnContext) : locatedColumns(columnContext),
    rows: () => rows,
    rowKey: (row) => row.key,
    itemNoun: { singular: "item", plural: "items" },
    pinnedRowKeys: () => manager.pinnedKeys,
    rowMark: (row) => {
      const mark = {
        pinned: manager.isPinned(row.key) || undefined,
        clipboard: manager.clipboardMarkOf(row.key),
      };
      return mark.pinned === undefined && mark.clipboard === undefined ? undefined : mark;
    },
    onSelectionChange: (keys) => {
      manager.selectedKeys = keys;
      // The panel follows the LAST row selected. Letting go of the row it describes has to reach
      // the panel; leaving it there reads as the click not having worked.
      manager.inspectorKey = keys.at(-1) ?? null;
    },
    onActivate: (row) => activate(row),
  });

  const selectedRows = $derived(rows.filter((row) => manager.selectedKeys.includes(row.key)));
  const inspectedRow = $derived(
    rows.find((row) => row.key === manager.inspectorKey) ??
      (manager.inspectorKey === null
        ? null
        : ((files ?? [])
            .filter((file) => fileKey(file.id) === manager.inspectorKey)
            .map((file) => ({ kind: "file", key: fileKey(file.id), file }) as const)[0] ?? null)),
  );

  // --- the rail ------------------------------------------------------------------------------------

  const treeNodes = $derived.by((): FolderTreeNode[] => {
    const build = (parentFolderId: string | null, seen: ReadonlySet<string>): FolderTreeNode[] =>
      index
        .childrenOf(parentFolderId)
        .filter((folder) => !seen.has(folder.id))
        .map((folder) => {
          // Carrying the ancestors down means a cycle in the data can never recurse until the
          // stack gives out, and a folder appears at most once on any path.
          const children = build(folder.id, new Set([...seen, folder.id]));
          const node: FolderTreeNode = Object.assign({
	id: folder.id,
	label: folder.name,
	fileCount: index.subtreeFiles(folder.id).length
}, folderAppearance[folder.id]);
          return children.length > 0 ? { ...node, children } : node;
        });
    return build(null, new Set());
  });

  /*
   * A folder's colour and mark are display facts about the folder, and the folder record carries
   * neither. They are held for this visit so the ruling's controls are real and reversible, and
   * the moment the record carries them this map is what gets replaced.
   */
  let folderAppearance = $state<Record<string, { color?: FolderColorName; icon?: FolderIconName }>>(
    {},
  );

  const railViews = $derived<FolderTreeView[]>([
    {
      id: "analysis",
      label: "File Analysis",
      icon: ShieldAlert,
    },
    { id: "deleted", label: "Deleted Files", icon: Trash2 },
    { id: "results", label: "Search Results", icon: Search },
    { id: "history", label: "History", icon: History },
  ]);

  const trail = $derived(
    index.pathTo(manager.currentFolderId).map((folder) => ({ id: folder.id, label: folder.name })),
  );

  /** The scope vocabulary: the matter and no wider. Application-wide search is the top bar's job. */
  const SEARCH_SCOPES: { value: "matter" | "files" | "folder"; label: string }[] = [
    { value: "matter", label: "Everything on this matter" },
    { value: "files", label: "Files only" },
    { value: "folder", label: "This folder" },
  ];

  const VIEW_TITLES: Readonly<Record<FileManagerView, string | null>> = {
    browse: null,
    analysis: "File Analysis",
    deleted: "Deleted Files",
    results: "Search Results",
    history: "History",
  };

  // --- acts ------------------------------------------------------------------------------------

  /**
   * Searching from the toolbar.
   *
   * The field is one control on one surface, so typing into it is what OPENS the results view and
   * emptying it is what leaves: a reader who clears the box has said they are done searching, and
   * being left staring at an empty results table would make them find their own way back.
   */
  function runSearch(query: string): void {
    manager.searchQuery = query;
    if (query.trim() !== "" && manager.view !== "results") manager.openView("results");
    else if (query.trim() === "" && manager.view === "results") manager.openFolder(null);
  }

  function activate(row: FileManagerRow): void {
    if (row.kind === "folder") {
      manager.openFolder(row.folder.id);
      return;
    }
    // A zip with bytes opens INTO itself: what somebody wants from an archive is what is in it,
    // and the central directory answers that without extracting anything.
    if (isZip(row.file.name, row.file.sniffedContentType) && row.file.currentVersionId !== null) {
      enterArchive({
        fileId: row.file.id,
        fileName: row.file.name,
        deleted: false,
        unscanned: row.file.scanVerdict !== "clean",
      });
      return;
    }
    // One "Open". A file with bytes opens its preview in the panel; a file without any opens the
    // panel anyway, on the tab that says why there is nothing to see.
    manager.setPanelOpen(true);
    manager.inspectorKey = row.key;
    manager.inspectorTab = "preview";
  }

  let newFolderPending = $state(false);

  async function makeFolder(): Promise<void> {
    if (manager.view !== "browse") return;
    newFolderPending = true;
    // A new name cannot collide: creation disambiguates in the copy convention rather than
    // refusing, because nobody typed this name and nobody should be asked to fix it.
    const siblings = index
      .childrenOf(manager.currentFolderId)
      .map((folder) => ({ key: folderKey(folder.id), name: folder.name }));
    const name = disambiguated("New Folder", siblings);
    const result = await createFolder(
      fetch,
      { matterId, parentFolderId: manager.currentFolderId, name },
      crypto.randomUUID(),
    );
    newFolderPending = false;
    if (result.kind === "ok") {
      // Naming it is part of making it: the folder arrives under a stand-in name nobody chose, so
      // the cursor lands in its name where a person is already about to type. Left to be found
      // afterwards, a new folder just sits there called "New Folder".
      renameAfterReload = result.value.folderId;
      reload();
      return;
    }
    actionFailure = "That folder could not be made.";
  }

  // --- renaming ------------------------------------------------------------------------------------

  let renameDraft = $state("");
  let renameConflict = $state<string | null>(null);
  /** A folder just made, waiting for the re-read that will let its name be typed. */
  let renameAfterReload = $state<string | null>(null);

  /*
   * The new folder's name field opens once the folder is actually in the list — a rename cannot be
   * started against a row that has not been read back yet.
   */
  $effect(() => {
    const waiting = renameAfterReload;
    if (waiting === null) return;
    const row = rows.find((candidate) => candidate.key === folderKey(waiting));
    if (row === undefined) return;
    renameAfterReload = null;
    beginRename(row);
  });

  function beginRename(row: FileManagerRow): void {
    manager.renamingKey = row.key;
    renameConflict = null;
    renameDraft =
      row.kind === "folder"
        ? row.folder.name
        : renameFieldValue(row.file.name, manager.hideExtensions);
  }

  function siblingsOf(row: FileManagerRow): { key: string; name: string }[] {
    const parent = row.kind === "folder" ? row.folder.parentFolderId : row.file.folderId;
    return [
      ...index.childrenOf(parent).map((folder) => ({ key: folderKey(folder.id), name: folder.name })),
      ...index.filesIn(parent).map((file) => ({ key: fileKey(file.id), name: file.name })),
    ];
  }

  async function commitRename(row: FileManagerRow): Promise<void> {
    const stored = row.kind === "folder" ? "" : splitName(row.file.name).extension;
    const wanted =
      row.kind === "folder"
        ? renameDraft.trim()
        : committedRename(renameDraft, stored, manager.hideExtensions);
    if (wanted === "") {
      manager.renamingKey = null;
      return;
    }
    // A DELIBERATE rename that would collide is refused where the name was typed, naming the exact
    // sibling it collides with. It is never silently mangled: nobody asked for "(2)" here.
    const collision = collidingSibling(wanted, siblingsOf(row), row.key);
    if (collision !== null) {
      renameConflict = renameConflictMessage(collision);
      return;
    }
    const result =
      row.kind === "folder"
        ? await patchFolder(fetch, row.folder.id, { name: wanted }, writeKey())
        : await patchFile(fetch, row.file.id, { name: wanted }, writeKey());
    manager.renamingKey = null;
    renameConflict = null;
    if (result.kind === "ok") reload();
    else actionFailure = "That name could not be saved.";
  }

  // --- moving --------------------------------------------------------------------------------------

  async function moveRows(
    keys: readonly string[],
    destinationFolderId: string | null,
    description: string,
  ): Promise<void> {
    const origins = new Map<string, string | null>();
    const results: boolean[] = [];
    for (const key of keys) {
      const row = rows.find((candidate) => candidate.key === key) ?? findRowAnywhere(key);
      if (row === null) continue;
      if (row.kind === "folder") {
        // A folder never drops into itself or anything inside it: that would detach the branch
        // from the matter and nothing downstream would notice.
        if (
          destinationFolderId !== null &&
          (destinationFolderId === row.folder.id ||
            index.descendantFolderIds(row.folder.id).includes(destinationFolderId))
        ) {
          continue;
        }
        origins.set(key, row.folder.parentFolderId);
        const outcome = await patchFolder(
          fetch,
          row.folder.id,
          { parentFolderId: destinationFolderId },
          writeKey(),
        );
        results.push(outcome.kind === "ok");
      } else {
        origins.set(key, row.file.folderId);
        const outcome = await patchFile(fetch, row.file.id, { folderId: destinationFolderId }, writeKey());
        results.push(outcome.kind === "ok");
      }
    }
    if (results.some((ok) => !ok)) {
      actionFailure = "Some of those could not be moved. Nothing else changed.";
    }
    if (origins.size > 0) {
      manager.moves.record({ description, keys: [...origins.keys()], origins, destinationFolderId });
      manager.moveRevision += 1;
    }
    reload();
  }

  function findRowAnywhere(key: string): FileManagerRow | null {
    const file = (files ?? []).find((candidate) => fileKey(candidate.id) === key);
    if (file !== undefined) return { kind: "file", key, file };
    const folder = folders.find((candidate) => folderKey(candidate.id) === key);
    if (folder !== undefined) return { kind: "folder", key, folder };
    return null;
  }

  async function undoMove(): Promise<void> {
    const move = manager.moves.takeUndo();
    manager.moveRevision += 1;
    if (move === null) return;
    for (const [key, origin] of move.origins) {
      const row = findRowAnywhere(key);
      if (row === null) continue;
      if (row.kind === "folder") await patchFolder(fetch, row.folder.id, { parentFolderId: origin }, writeKey());
      else await patchFile(fetch, row.file.id, { folderId: origin }, writeKey());
    }
    reload();
  }

  /** Walk back through several recorded moves at once, from the stack. */
  async function undoMoves(steps: number): Promise<void> {
    for (let taken = 0; taken < steps; taken += 1) await undoMove();
  }

  async function redoMoves(steps: number): Promise<void> {
    for (let taken = 0; taken < steps; taken += 1) await redoMove();
  }

  async function redoMove(): Promise<void> {
    const move = manager.moves.takeRedo();
    manager.moveRevision += 1;
    if (move === null) return;
    for (const key of move.keys) {
      const row = findRowAnywhere(key);
      if (row === null) continue;
      if (row.kind === "folder") {
        await patchFolder(
          fetch,
          row.folder.id,
          { parentFolderId: move.destinationFolderId },
          writeKey(),
        );
      } else {
        await patchFile(fetch, row.file.id, { folderId: move.destinationFolderId }, writeKey());
      }
    }
    reload();
  }

  // --- deleting ------------------------------------------------------------------------------------

  let folderToDelete = $state<FolderSummary | null>(null);
  let folderDeleteOpen = $state(false);
  let folderDeleteRunning = $state(false);
  let folderDeleteFailure = $state<string | null>(null);

  async function deleteRows(targets: readonly FileManagerRow[]): Promise<void> {
    const fileRows = targets.filter((row) => row.kind === "file");
    const folderRows = targets.filter((row) => row.kind === "folder");

    if (folderRows.length === 1 && fileRows.length === 0) {
      const only = folderRows[0];
      if (only?.kind !== "folder") return;
      const contents = index.subtreeFiles(only.folder.id).length;
      const subfolders = index.descendantFolderIds(only.folder.id).length;
      if (contents === 0 && subfolders === 0) {
        // An empty folder deletes with no dialog: there is no decision to make about contents
        // that do not exist.
        const outcome = await deleteFolderRequest(fetch, only.folder.id, writeKey());
        if (outcome.kind !== "ok") actionFailure = "That folder could not be deleted.";
        reload();
        return;
      }
      folderToDelete = only.folder;
      folderDeleteFailure = null;
      folderDeleteOpen = true;
      return;
    }

    // A soft delete: the row leaves the list, the bytes and every version stay.
    const outcomes = await Promise.all(
      fileRows.map((row) => (row.kind === "file" ? deleteFile(fetch, row.file.id, writeKey()) : null)),
    );
    if (outcomes.some((outcome) => outcome !== null && outcome.kind !== "ok")) {
      actionFailure =
        fileRows.length === 1
          ? "That file could not be deleted."
          : "Some of those files could not be deleted.";
    }
    reload();
  }

  async function confirmFolderDelete(choice: {
    keepContents: boolean;
    destinationFolderId: string | null;
  }): Promise<void> {
    const target = folderToDelete;
    if (target === null) return;
    folderDeleteRunning = true;
    folderDeleteFailure = null;

    const descendants = index.descendantFolderIds(target.id);
    const held = index.subtreeFiles(target.id);
    let trouble = false;

    if (choice.keepContents) {
      // Keeping the contents means moving them out first: the route refuses a folder that still
      // holds anything, which is the right refusal and the reason this is two steps.
      for (const file of held) {
        const outcome = await patchFile(
          fetch,
          file.id,
          { folderId: choice.destinationFolderId },
          writeKey(),
        );
        if (outcome.kind !== "ok") trouble = true;
      }
      for (const folderId of index.childrenOf(target.id).map((folder) => folder.id)) {
        const outcome = await patchFolder(
          fetch,
          folderId,
          { parentFolderId: choice.destinationFolderId },
          writeKey(),
        );
        if (outcome.kind !== "ok") trouble = true;
      }
    } else {
      for (const file of held) {
        const outcome = await deleteFile(fetch, file.id, writeKey());
        if (outcome.kind !== "ok") trouble = true;
      }
      // Deepest first, because a folder cannot go while it still holds one.
      for (const folderId of descendants.toReversed()) {
        const outcome = await deleteFolderRequest(fetch, folderId, writeKey());
        if (outcome.kind !== "ok") trouble = true;
      }
    }

    if (!trouble) {
      const outcome = await deleteFolderRequest(fetch, target.id, writeKey());
      if (outcome.kind !== "ok") trouble = true;
    }

    folderDeleteRunning = false;
    if (trouble) {
      folderDeleteFailure =
        "Part of that did not go through, so the folder was left in place. Nothing was lost.";
      reload();
      return;
    }
    folderDeleteOpen = false;
    folderToDelete = null;
    reload();
  }

  // --- downloading ---------------------------------------------------------------------------------

  function download(targets: readonly FileManagerRow[]): void {
    // A folder downloads as its files: the subtree is expanded here, because the row itself has no
    // bytes. Bundling them into one archive is the download route's job, which this list does not
    // call yet, so asking for several opens several.
    const expanded = targets.flatMap((row): FileManagerRow[] =>
      row.kind === "file"
        ? [row]
        : index
            .subtreeFiles(row.folder.id)
            .map((file) => ({ kind: "file", key: fileKey(file.id), file }) as const),
    );
    const fileRows = expanded.filter(
      (row) => row.kind === "file" && row.file.currentVersionId !== null,
    );
    if (fileRows.length === 0) {
      actionFailure = "None of those has a committed version yet, so there are no bytes to fetch.";
      return;
    }
    // Each file is fetched from its own signed URL. Bundling several into one archive is a
    // server-side job the surface reaches through the download route, which this list does not
    // call yet, so asking for several opens several rather than pretending to zip them here.
    for (const row of fileRows) {
      if (row.kind !== "file") continue;
      globalThis.open(fileDownloadUrl(row.file.id), "_blank", "noopener");
    }
  }

  // --- uploading -----------------------------------------------------------------------------------

  /*
   * The bytes never wait on the destination question. The batch starts uploading the moment it is
   * picked — into the folder the reader is standing in — while the Upload dialog shows each file's
   * own progress and asks where the batch belongs. Confirming a different folder re-files each
   * file as it lands (a move is one metadata write); closing the dialog abandons nothing.
   */
  let filePicker = $state<HTMLInputElement | null>(null);
  let uploadOpen = $state(false);
  let uploadItems = $state<readonly UploadProgressItem[]>([]);
  let uploadBaseFolderId = $state<string | null>(null);
  let uploadConfirmed = $state(false);
  let uploadChosenFolderId = $state<string | null>(null);
  /** The committed file ids, by batch position, for the re-file on confirm. */
  let uploadLandedFileIds: (string | null)[] = [];
  /** Guards a superseded batch: its late updates must not touch a newer dialog. */
  let uploadBatchToken = 0;

  function offerUpload(chosen: readonly File[]): void {
    if (chosen.length === 0) return;
    uploadBaseFolderId = manager.view === "browse" ? manager.currentFolderId : null;
    uploadItems = chosen.map((file) => ({ name: file.name, stage: "reserving" as const }));
    uploadConfirmed = false;
    uploadChosenFolderId = null;
    uploadLandedFileIds = chosen.map(() => null);
    uploadOpen = true;
    uploadBatchToken += 1;
    void runUploadBatch(chosen, uploadBaseFolderId, uploadBatchToken);
  }

  function setUploadItem(at: number, next: UploadProgressItem): void {
    uploadItems = uploadItems.map((item, position) => (position === at ? next : item));
  }

  /** The failure line carries the stage and the Error ID: a report needs both, and a bare
   * "unexpected error" was exactly the undiagnosable answer this replaces. */
  function uploadFailureReason(outcome: UploadOutcome & { kind: "problem" }): string {
    const where = UPLOAD_STAGE_NARRATION[outcome.stage].toLowerCase();
    const errorId = outcome.problem.errorId;
    return (
      problemGuidance(outcome.problem).message +
      ` (failed while ${where}` +
      (errorId === undefined ? ")" : `; Error ID ${errorId})`)
    );
  }

  async function runUploadBatch(
    chosen: readonly File[],
    baseFolderId: string | null,
    batch: number,
  ): Promise<void> {
    const taken = index
      .filesIn(baseFolderId)
      .map((file) => ({ key: fileKey(file.id), name: file.name }));

    for (let at = 0; at < chosen.length; at += 1) {
      const file = chosen[at];
      if (file === undefined) continue;
      // An upload that lands on a name already taken disambiguates in the copy convention: the
      // reader asked for this file to be here, and refusing it would be the worse answer.
      const name = disambiguated(file.name, taken);
      const outcome = await uploadIntoFolder({
        fetchImpl: fetch,
        matterId,
        folderId: baseFolderId,
        file,
        name,
        onStage: (stage) => {
          if (batch === uploadBatchToken) setUploadItem(at, { name: file.name, stage });
        },
      });
      taken.push({ key: `pending:${name}`, name });
      if (batch !== uploadBatchToken) return;
      if (outcome.kind === "problem") {
        setUploadItem(at, { name: file.name, stage: "failed", reason: uploadFailureReason(outcome) });
      } else if (outcome.kind === "transport") {
        setUploadItem(at, {
          name: file.name,
          stage: "failed",
          reason:
            "Nothing answered while " + UPLOAD_STAGE_NARRATION[outcome.stage].toLowerCase() + ".",
        });
      } else {
        uploadLandedFileIds[at] = outcome.fileId;
        // A destination confirmed while this file was still in flight applies to it now.
        if (uploadConfirmed && uploadChosenFolderId !== baseFolderId) {
          await patchFile(fetch, outcome.fileId, { folderId: uploadChosenFolderId }, writeKey());
        }
        setUploadItem(at, { name: file.name, stage: "settled" });
        reload();
      }
    }
    finishUploadIfDone();
  }

  async function confirmUploadDestination(destinationFolderId: string | null): Promise<void> {
    uploadConfirmed = true;
    uploadChosenFolderId = destinationFolderId;
    if (destinationFolderId !== uploadBaseFolderId) {
      for (const landedFileId of uploadLandedFileIds) {
        if (landedFileId !== null) {
          await patchFile(fetch, landedFileId, { folderId: destinationFolderId }, writeKey());
        }
      }
      reload();
    }
    finishUploadIfDone();
  }

  function finishUploadIfDone(): void {
    const allSettled =
      uploadItems.length > 0 &&
      uploadItems.every((item) => item.stage === "settled" || item.stage === "failed");
    const anyFailed = uploadItems.some((item) => item.stage === "failed");
    if (!uploadConfirmed || !allSettled || anyFailed) return;
    uploadOpen = false;
    const destination = uploadChosenFolderId;
    // The batch landed where it was asked to land, so show that folder.
    if (manager.view === "browse" && destination !== manager.currentFolderId) {
      manager.openFolder(destination);
    }
    reload();
  }

  // --- the details panel's own reads ----------------------------------------------------------------

  let versions = $state<readonly MatterFileVersion[] | null>(null);
  let versionsLoading = $state(false);
  let integrity = $state<IntegrityVerification | null>(null);
  let integrityRunning = $state(false);

  $effect(() => {
    const row = inspectedRow;
    // A new subject resets what the panel knows: a digest computed for one file must never be
    // read as another file's.
    integrity = null;
    if (row === null || row.kind !== "file") {
      versions = null;
      return;
    }
    const fileId = row.file.id;
    let cancelled = false;
    versionsLoading = true;
    void (async () => {
      const outcome = await listFileVersions(fetch, fileId);
      if (cancelled) return;
      versions = outcome.kind === "ok" ? outcome.value.data : null;
      versionsLoading = false;
    })();
    return () => {
      cancelled = true;
    };
  });

  async function runIntegrityCheck(): Promise<void> {
    const row = inspectedRow;
    if (row === null || row.kind !== "file") return;
    integrityRunning = true;
    const outcome = await verifyFileIntegrity(fetch, row.file.id);
    integrityRunning = false;
    integrity = outcome.kind === "ok" ? outcome.value : null;
    if (outcome.kind !== "ok") {
      actionFailure = "The digests could not be recomputed. The file itself is unaffected.";
    }
  }

  const analysisReport = $derived(
    issueReportText(files ?? [], shownIssues, (file) => index.pathText(file.folderId)),
  );

  function downloadIssueReport(): void {
    const blob = new Blob([analysisReport], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "file-analysis.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  function setIgnored(issues: readonly Issue[], ignored: boolean): void {
    const next = new Set(ignoredIssues);
    for (const issue of issues) {
      if (ignored) next.add(issueKey(issue));
      else next.delete(issueKey(issue));
    }
    ignoredIssues = next;
  }

  // --- the right-click menu ------------------------------------------------------------------------

  let menuTargets = $state<readonly FileManagerRow[]>([]);
  let menuIsBackground = $state(false);

  function retarget(event: MouseEvent, row: FileManagerRow): void {
    menuIsBackground = false;
    // Right-clicking inside the selection speaks for all of it; right-clicking outside re-targets
    // that one row first, so the menu never acts on something the reader was not pointing at.
    if (!grid.isSelected(row.key)) grid.rowClick(row.key, { repeated: true });
    menuTargets = grid.isSelected(row.key) ? selectedRows : [row];
    void event;
  }

  const menuEntries = $derived.by(() => {
    if (menuIsBackground) {
      return backgroundMenu({
        view: manager.view,
        clipboardHolds: manager.clipboard !== null,
        hasDestination: manager.view === "browse",
      });
    }
    if (menuTargets.length === 0) return [];
    const folderRows = menuTargets.filter((row) => row.kind === "folder");
    return rowMenu({
      rows: menuTargets,
      view: manager.view,
      allPinned: menuTargets.every((row) => manager.isPinned(row.key)),
      clipboardHolds: manager.clipboard !== null,
      hasDestination: manager.view === "browse",
      nonEmptyFolderCount: folderRows.filter(
        (row) =>
          row.kind === "folder" &&
          (index.subtreeFiles(row.folder.id).length > 0 ||
            index.childrenOf(row.folder.id).length > 0),
      ).length,
      openIssueCount: menuIssues(false).length,
      ignoredIssueCount: menuIssues(true).length,
    });
  });

  /** The issues the menu's own scope carries, in whichever direction is being asked about. */
  function menuIssues(ignored: boolean): Issue[] {
    const scoped = new Set(
      menuTargets.filter((row) => row.kind === "file").map((row) => row.key),
    );
    return everyIssue
      .filter((issue) => scoped.has(fileKey(issue.fileId)))
      .filter((issue) => ignoredIssues.has(issueKey(issue)) === ignored);
  }

  const menuFolderRows = $derived(menuTargets.filter((row) => row.kind === "folder"));
  const sharedColor = $derived.by((): FolderColorName | null => {
    const marks = menuFolderRows.map((row) =>
      row.kind === "folder" ? folderAppearance[row.folder.id]?.color : undefined,
    );
    const first = marks[0];
    return marks.length > 0 && marks.every((mark) => mark === first) ? (first ?? null) : null;
  });
  const sharedIcon = $derived.by((): FolderIconName | null => {
    const marks = menuFolderRows.map((row) =>
      row.kind === "folder" ? folderAppearance[row.folder.id]?.icon : undefined,
    );
    const first = marks[0];
    return marks.length > 0 && marks.every((mark) => mark === first) ? (first ?? null) : null;
  });
  const sharedDocumentTypeId = $derived.by((): string | null => {
    const fileRows = menuTargets.filter((row) => row.kind === "file");
    const marks = fileRows.map((row) => (row.kind === "file" ? row.file.documentTypeId : null));
    const first = marks[0] ?? null;
    return marks.length > 0 && marks.every((mark) => mark === first) ? first : null;
  });

  async function runCommand(command: FileMenuCommand): Promise<void> {
    const targets = menuIsBackground ? [] : menuTargets;
    const only = targets[0];
    actionFailure = null;
    switch (command) {
      case "open":
        if (only !== undefined) activate(only);
        return;
      case "download":
        download(targets);
        return;
      case "pin":
        manager.setPinned(
          targets.map((row) => row.key),
          true,
        );
        return;
      case "unpin":
        manager.setPinned(
          targets.map((row) => row.key),
          false,
        );
        return;
      case "rename":
        if (only !== undefined) beginRename(only);
        return;
      case "cut":
        manager.mark(
          targets.map((row) => row.key),
          "cut",
        );
        return;
      case "paste": {
        const clipboard = manager.clipboard;
        if (clipboard === null || manager.view !== "browse") return;
        await moveRows(
          clipboard.keys,
          manager.currentFolderId,
          `moving ${countPhrase(clipboard.keys.length, "item")} to ${index.pathText(manager.currentFolderId)}`,
        );
        manager.clearClipboard();
        return;
      }
      case "delete":
        await deleteRows(targets);
        return;
      case "newFolder":
        await makeFolder();
        return;
      case "newDocument":
      case "upload":
        filePicker?.click();
        return;
      case "selectAll":
        grid.selectAll();
        return;
      case "ignoreIssues":
        setIgnored(menuIssues(false), true);
        return;
      case "unignoreIssues":
        setIgnored(menuIssues(true), false);
        return;
      case "filterToThis":
        if (only?.kind === "file") {
          grid.setFilter("name", {
            kind: "text",
            query: displayName(only.file.name, manager.hideExtensions),
          });
        }
        return;
      case "saveNewVersion":
        // The same picker, then the same ceremony against the file it was asked on.
        if (only?.kind === "file") saveVersionFor = only.file;
        filePicker?.click();
        return;
      case "browseInside":
        if (only?.kind === "file") {
          enterArchive({
            fileId: only.file.id,
            fileName: only.file.name,
            deleted: false,
            unscanned: only.file.scanVerdict !== "clean",
          });
        }
        return;
      default:
        return;
    }
  }

  /** Set when the picker was opened to add a version rather than a new file. */
  let saveVersionFor = $state<MatterFile | null>(null);

  async function pickedFiles(chosen: readonly File[]): Promise<void> {
    const target = saveVersionFor;
    saveVersionFor = null;
    if (target === null) {
      offerUpload(chosen);
      return;
    }
    // Saving a new version asks nothing: its destination is the file it was asked on.
    const first = chosen[0];
    if (first === undefined) return;
    const outcome = await uploadIntoFolder({
      fetchImpl: fetch,
      matterId,
      folderId: target.folderId,
      file: first,
      name: target.name,
      fileId: target.id,
    });
    if (outcome.kind === "problem" || outcome.kind === "transport") {
      actionFailure = "That version was not saved. The file is unchanged.";
    }
    reload();
  }

  async function applyDocumentTypeTo(
    targets: readonly FileManagerRow[],
    documentTypeId: string | null,
  ): Promise<void> {
    const fileRows = targets.filter((row) => row.kind === "file");
    const outcomes = await Promise.all(
      fileRows.map((row) =>
        row.kind === "file" ? patchFile(fetch, row.file.id, { documentTypeId }, writeKey()) : null,
      ),
    );
    if (outcomes.some((outcome) => outcome !== null && outcome.kind !== "ok")) {
      actionFailure = "That document type could not be set.";
    }
    reload();
  }

  /** Adding to the firm's vocabulary, then setting what was just added. One gesture, two writes. */
  async function addDocumentTypeFor(
    targets: readonly FileManagerRow[],
    name: string,
  ): Promise<void> {
    const outcome = await createDocumentType(fetch, name, crypto.randomUUID());
    if (outcome.kind !== "ok") {
      actionFailure = "That document type could not be added to the firm's list.";
      return;
    }
    await applyDocumentTypeTo(targets, outcome.value.id);
    const refreshed = await listDocumentTypes(fetch);
    if (refreshed.kind === "ok") documentTypes = refreshed.value.data;
  }

  // --- the keyboard ----------------------------------------------------------------------------------

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    const inField =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    // Escape closes what is open even from inside a field: a menu parked over the list is the one
    // thing a reader cannot type their way out of.
    if (event.key === "Escape" && manager.renamingKey !== null) {
      manager.renamingKey = null;
      renameConflict = null;
      return;
    }
    if (inField) return;

    if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      manager.goBack();
      return;
    }
    if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      manager.goForward();
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      manager.goUp(index.folderById(manager.currentFolderId ?? "")?.parentFolderId ?? null);
      return;
    }
    if (event.key === "F2" && selectedRows.length === 1) {
      event.preventDefault();
      const only = selectedRows[0];
      if (only !== undefined) beginRename(only);
      return;
    }
    if (event.key === "Delete" && selectedRows.length > 0) {
      event.preventDefault();
      void deleteRows(selectedRows);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      grid.selectAll();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
      event.preventDefault();
      manager.mark(
        selectedRows.map((row) => row.key),
        "cut",
      );
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      menuIsBackground = false;
      void runCommand("paste");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      void (event.shiftKey ? redoMove() : undoMove());
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      void redoMove();
    }
  }

  // --- dropping files onto the list -------------------------------------------------------------------

  let dragDepth = $state(0);
  const dragOver = $derived(dragDepth > 0);

  /** Only a drag that carries FILES is an upload; a row or folder being moved must not open it. */
  function carriesFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  // --- the side panes -------------------------------------------------------------------------------

  /*
   * Both side panes stay MOUNTED and collapse in place. Unmounting one made the group re-lay out
   * every pane proportionally, so closing the folder tree visibly widened the details panel;
   * collapsing hands the freed space to the list alone.
   */
  interface PaneHandle {
    collapse: () => void;
    expand: () => void;
    isCollapsed: () => boolean;
  }
  let railPane = $state<PaneHandle | null>(null);
  let inspectorPane = $state<PaneHandle | null>(null);

  function toggleRail(): void {
    if (railPane === null) return;
    if (railPane.isCollapsed()) railPane.expand();
    else railPane.collapse();
  }

  function togglePanel(): void {
    if (inspectorPane === null) return;
    if (inspectorPane.isCollapsed()) inspectorPane.expand();
    else inspectorPane.collapse();
  }

  // The remembered open/closed choice is applied once the panes exist; after that the panes
  // themselves are the source of truth and the preference just records their state.
  let panesAligned = false;
  $effect(() => {
    if (panesAligned || railPane === null || inspectorPane === null) return;
    panesAligned = true;
    if (!manager.railOpen && !railPane.isCollapsed()) railPane.collapse();
    if (manager.railOpen && railPane.isCollapsed()) railPane.expand();
    if (!manager.panelOpen && !inspectorPane.isCollapsed()) inspectorPane.collapse();
    if (manager.panelOpen && inspectorPane.isCollapsed()) inspectorPane.expand();
  });


  // --- the deleted-files and history views ----------------------------------------------------------

  /*
   * Deleted files are matter files that happen to be deleted, and the changelog is a table of
   * facts — so both render on the product's one table, each with its own column set. The reads are
   * cursor-paged; the first page loads when the view opens and Load More walks the rest.
   */
  let deletedFiles = $state<readonly DeletedFileSummary[]>([]);
  let deletedCursor = $state<string | null>(null);
  let deletedLoading = $state(false);
  let historyEntries = $state<readonly FileHistoryEntry[]>([]);
  let historyCursor = $state<string | null>(null);
  let historyLoading = $state(false);

  $effect(() => {
    void reloadToken;
    if (manager.view !== "deleted") return;
    let cancelled = false;
    deletedLoading = true;
    void (async () => {
      const outcome = await listDeletedFiles(fetch, matterId);
      if (cancelled) return;
      deletedLoading = false;
      if (outcome.kind !== "ok") {
        actionFailure = "The deleted files could not be read. Nothing about them changed.";
        return;
      }
      deletedFiles = outcome.value.data;
      deletedCursor = outcome.value.nextCursor;
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    void reloadToken;
    if (manager.view !== "history") return;
    let cancelled = false;
    historyLoading = true;
    void (async () => {
      const outcome = await listFileHistory(fetch, matterId);
      if (cancelled) return;
      historyLoading = false;
      if (outcome.kind !== "ok") {
        actionFailure = "The history could not be read. The record itself is unaffected.";
        return;
      }
      historyEntries = outcome.value.data;
      historyCursor = outcome.value.nextCursor;
    })();
    return () => {
      cancelled = true;
    };
  });

  async function loadMoreDeleted(): Promise<void> {
    if (deletedCursor === null) return;
    const outcome = await listDeletedFiles(fetch, matterId, deletedCursor);
    if (outcome.kind !== "ok") return;
    deletedFiles = [...deletedFiles, ...outcome.value.data];
    deletedCursor = outcome.value.nextCursor;
  }

  async function loadMoreHistory(): Promise<void> {
    if (historyCursor === null) return;
    const outcome = await listFileHistory(fetch, matterId, historyCursor);
    if (outcome.kind !== "ok") return;
    historyEntries = [...historyEntries, ...outcome.value.data];
    historyCursor = outcome.value.nextCursor;
  }

  const deletedGrid = DataTable.createDataTableGrid<DeletedFileSummary>({
    columns: () =>
      deletedColumns({ index, hideExtensions: manager.hideExtensions, documentTypeName }),
    rows: () => (manager.view === "deleted" ? [...deletedFiles] : []),
    rowKey: (row) => row.id,
    itemNoun: { singular: "deleted file", plural: "deleted files" },
    // A deleted zip still browses — reading its directory restores nothing — so opening one looks
    // inside it; everything else opens the restore question, which is the only act it has.
    onActivate: (row) =>
      isZip(row.name, row.sniffedContentType) && row.currentVersionId !== null
        ? enterArchive({ fileId: row.id, fileName: row.name, deleted: true, unscanned: false })
        : beginRestore(row),
  });

  const historyGrid = DataTable.createDataTableGrid<FileHistoryEntry>({
    columns: () => historyColumns(),
    rows: () => (manager.view === "history" ? [...historyEntries] : []),
    rowKey: (row) => `${row.at}:${row.subjectId}:${row.event}`,
    itemNoun: { singular: "entry", plural: "entries" },
  });

  let restoreTarget = $state<DeletedFileSummary | null>(null);
  let restoreOpen = $state(false);
  let restoreRunning = $state(false);
  let restoreFailure = $state<string | null>(null);

  function beginRestore(row: DeletedFileSummary): void {
    restoreTarget = row;
    restoreFailure = null;
    restoreOpen = true;
  }

  async function confirmRestore(destination: { folderId?: string | null }): Promise<void> {
    const target = restoreTarget;
    if (target === null) return;
    restoreRunning = true;
    restoreFailure = null;
    const outcome = await restoreFile(fetch, target.id, destination, crypto.randomUUID());
    restoreRunning = false;
    if (outcome.kind !== "ok") {
      restoreFailure =
        outcome.kind === "problem"
          ? problemGuidance(outcome.problem).message
          : "Nothing answered. The file stays deleted, and nothing else changed.";
      return;
    }
    restoreOpen = false;
    restoreTarget = null;
    deletedFiles = deletedFiles.filter((row) => row.id !== target.id);
    reload();
  }

  // --- browsing inside an archive -------------------------------------------------------------------

  /*
   * Browsing a zip reads its central directory out of the stored bytes — nothing is extracted and
   * nothing changes, which is why a deleted zip browses the same as a live one. The view stands in
   * for the file list while it is open; stepping anywhere else — a folder, a rail view — steps out.
   */
  interface ArchiveBrowseState {
    readonly fileId: string;
    readonly fileName: string;
    /** Entered from Deleted Files. Browsing restores nothing, and the bar says where it came from. */
    readonly deleted: boolean;
    /** The zip's own safety check has not come back clean, which the reader sees before trusting it. */
    readonly unscanned: boolean;
  }

  let archiveBrowse = $state<ArchiveBrowseState | null>(null);
  /** The level being shown: "" is the archive's root, otherwise a directory prefix ending in "/". */
  let archivePath = $state("");
  let archiveEntriesHeld = $state<readonly ArchiveEntry[]>([]);
  let archiveTruncated = $state(false);
  let archiveLoading = $state(false);
  let archiveFailure = $state<string | null>(null);

  /** What the row's own facts say: sniffed as a zip, or named one when nothing was sniffed. */
  function isZip(name: string, sniffedContentType: string | null): boolean {
    return sniffedContentType === "application/zip" || name.toLowerCase().endsWith(".zip");
  }

  function enterArchive(target: ArchiveBrowseState): void {
    archiveBrowse = target;
    archivePath = "";
    archiveEntriesHeld = [];
    archiveTruncated = false;
    archiveFailure = null;
    archiveLoading = true;
    void (async () => {
      const outcome = await listArchiveEntries(fetch, target.fileId);
      // The reader may have stepped out, or into another zip, while this one was being read.
      if (archiveBrowse?.fileId !== target.fileId) return;
      archiveLoading = false;
      if (outcome.kind !== "ok") {
        archiveFailure =
          outcome.kind === "problem"
            ? problemGuidance(outcome.problem).message
            : "Nothing answered. The archive itself is unaffected.";
        return;
      }
      archiveEntriesHeld = outcome.value.entries;
      archiveTruncated = outcome.value.truncated;
    })();
  }

  function leaveArchive(): void {
    archiveBrowse = null;
    archivePath = "";
    archiveEntriesHeld = [];
    archiveTruncated = false;
    archiveLoading = false;
    archiveFailure = null;
  }

  // Navigating anywhere — a folder, a rail view — is stepping out of the archive.
  $effect(() => {
    void manager.place;
    leaveArchive();
  });

  const archiveGrid = DataTable.createDataTableGrid<ArchiveRow>({
    columns: () => archiveColumns(),
    rows: () =>
      archiveBrowse === null ? [] : archiveLevelRows([...archiveEntriesHeld], archivePath),
    rowKey: (row) => row.path,
    itemNoun: { singular: "member", plural: "members" },
    onActivate: (row) => {
      if (row.kind === "directory") archivePath = row.path;
    },
  });

  // --- the rail's right-click -----------------------------------------------------------------------

  /*
   * The folder tree's right-click carries the same acts the list's right-click carries — open,
   * download, pin, rename, cut, paste, delete — with the design system's colour and mark flyouts
   * beneath them. One vocabulary for a folder wherever it is pointed at.
   */
  function railRowOf(folderId: string | null): FileManagerRow | null {
    return folderId === null ? null : findRowAnywhere(folderKey(folderId));
  }

  function renameFromRail(row: FileManagerRow): void {
    if (row.kind !== "folder") return;
    // The rename field lives on the row in the LIST, so the list is first brought to the level the
    // folder sits at; the field then opens on the right row.
    manager.openFolder(row.folder.parentFolderId);
    beginRename(row);
  }

  async function pasteIntoFolder(folderId: string | null): Promise<void> {
    const clipboard = manager.clipboard;
    if (clipboard === null) return;
    await moveRows(
      clipboard.keys,
      folderId,
      `moving ${countPhrase(clipboard.keys.length, "item")} to ${index.pathText(folderId)}`,
    );
    manager.clearClipboard();
  }

  // --- the footer's tally ---------------------------------------------------------------------------

  /** "2 folders, 5 files" — the artifact's phrasing; folders lead because they render first. */
  const footerTally = $derived.by(() => {
    const folderCount = rows.filter((row) => row.kind === "folder").length;
    const fileCount = rows.length - folderCount;
    if (rows.length === 0) return "Nothing here";
    return [
      folderCount > 0 ? countPhrase(folderCount, "folder") : "",
      countPhrase(fileCount, "file"),
    ]
      .filter(Boolean)
      .join(", ");
  });
</script>

<svelte:window onkeydown={onKeyDown} />

<!-- Growth, not a percentage: the ancestors' heights come from flex-grow over a min-height
     container, which the percentage-resolution rules treat as indefinite — an h-full here silently
     collapsed the panes to their content height. flex-1 grows into the same space without asking
     the parent to be definite. -->
<div class="flex min-h-0 flex-1 flex-col">
  {#if loadFailure !== null}
    <!-- The error view is a PANE, not a dialog: it scrolls inside its own container, so a long
         explanation can never push its own controls off the screen. -->
    <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto p-16">
      <Alert.Root variant="danger">
        <Alert.Title>The Files Could Not Be Read</Alert.Title>
        <Alert.Description>
          <span class="block">{loadFailure}</span>
          <span class="block">
            The record itself is unaffected: nothing was changed, and nothing was lost.
          </span>
          <span class="mt-4 block">First, try each of these in order:</span>
          <span class="block">1. Reload this view.</span>
          <span class="block">2. Check that you are still connected.</span>
          <span class="block">3. Open the matter again from the matters list.</span>
        </Alert.Description>
      </Alert.Root>
      <div class="mt-16 flex gap-8">
        <Button onclick={reload}>Retry</Button>
      </div>
    </div>
  {:else}
    {#if actionFailure !== null}
      <div class="px-16 pt-12">
        <Alert.Root variant="warning">
          <Alert.Title>That Did Not Go Through</Alert.Title>
          <Alert.Description>{actionFailure}</Alert.Description>
        </Alert.Root>
      </div>
    {/if}

    <!-- The pane group GROWS rather than asking for 100%: every height above it comes from
         flex-grow over a min-height container, which percentage resolution treats as indefinite. -->
    <div class="flex min-h-0 flex-1 flex-col">
      <Resizable.PaneGroup
        direction="horizontal"
        autoSaveId="matter-files-panes"
        class="min-h-0 flex-1"
      >
        <Resizable.Pane
          bind:this={railPane}
          defaultSize={20}
          minSize={12}
          maxSize={36}
          collapsible
          collapsedSize={0}
          class="flex min-h-0 flex-col"
          onCollapse={() => manager.setRailOpen(false)}
          onExpand={() => manager.setRailOpen(true)}
        >
          <!-- The sunken surface sets the rail apart from the list — a sidebar the same white as
               the work area reads as more work area. -->
          <FolderTree
              class="min-h-0 flex-1 bg-surface-sunken"
              folders={treeNodes}
              bind:selectedFolderId={
                () => (manager.view === "browse" ? manager.currentFolderId : null),
                (next) => manager.openFolder(next)
              }
              bind:expandedFolderIds={manager.expandedFolderIds}
              views={railViews}
              currentViewId={manager.view === "browse" ? undefined : manager.view}
              showFileCounts={manager.showSidebarCounts}
              {loading}
              label="Matter folders"
              emptyMessage="No folders yet. Everything on this matter sits at the top level until one is made."
              newFolderDisabledReason={manager.view === "browse"
                ? undefined
                : "This view has no current folder to make one in."}
              onNewFolder={() => void makeFolder()}
              onSelectView={(viewId) => manager.openView(viewId as FileManagerView)}
              onMoveFolder={(move) =>
                void moveRows(
                  [folderKey(move.folderId)],
                  move.destinationFolderId,
                  `moving a folder to ${index.pathText(move.destinationFolderId)}`,
                )}
              onChangeColor={({ folderId, color }) => {
                folderAppearance = { ...folderAppearance, [folderId]: { ...folderAppearance[folderId], color } };
              }}
              onChangeIcon={({ folderId, icon }) => {
                folderAppearance = { ...folderAppearance, [folderId]: { ...folderAppearance[folderId], icon } };
              }}
              menuItems={railMenuItems}
            />
        </Resizable.Pane>
        <Resizable.Handle />

        <Resizable.Pane defaultSize={54} minSize={30} class="flex min-h-0 flex-col">
          <div
            class="flex min-h-0 flex-1 flex-col"
            role="presentation"
            style={dragOver
              ? "box-shadow: inset var(--mc-space-0) var(--mc-space-0) var(--mc-space-0) var(--mc-focus-ring-width) var(--mc-accent-strong)"
              : undefined}
            ondragenter={(event) => {
              if (!carriesFiles(event)) return;
              event.preventDefault();
              dragDepth += 1;
            }}
            ondragover={(event) => {
              if (carriesFiles(event)) event.preventDefault();
            }}
            ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
            ondrop={(event) => {
              if (!carriesFiles(event)) return;
              event.preventDefault();
              dragDepth = 0;
              const dropped = event.dataTransfer?.files;
              if (dropped && dropped.length > 0) offerUpload([...dropped]);
            }}
          >
            <FileManagerToolbar
              {manager}
              {trail}
              viewTitle={VIEW_TITLES[manager.view]}
              onToggleRail={toggleRail}
              onTogglePanel={togglePanel}
              onNewFolder={() => void makeFolder()}
              onNewDocument={() => filePicker?.click()}
              onUpload={() => filePicker?.click()}
              onSearch={runSearch}
            />

            {#if archiveBrowse !== null}
              <!-- Inside a zip, the archive stands in for the LIST and only the list: the toolbar
                   above holds still, and everything archive-specific — the crumb, the badges, the
                   extract seam, the way out — rides the FOOTER rather than pushing the table down.
                   A read that failed takes the table's own region, for the same reason. -->
              <div class="flex min-h-0 flex-1 flex-col">
                {#if archiveFailure !== null}
                  <div class="p-12">
                    <Alert.Root variant="warning">
                      <Alert.Title>The Archive Could Not Be Read</Alert.Title>
                      <Alert.Description>{archiveFailure}</Alert.Description>
                    </Alert.Root>
                  </div>
                {:else}
                  <DataTable.Grid
                    grid={archiveGrid}
                    cell={archiveCell}
                    settings={displaySettings}
                    caption="Inside this archive"
                    empty={emptyArchive}
                    loading={archiveLoading}
                    density={manager.scalePercent < 100 ? "compact" : "comfortable"}
                    class="h-full rounded-none border-0"
                  />
                  {#if archiveTruncated}
                    <div class="border-t border-border-default px-12 py-4 text-xs text-text-muted">
                      This archive holds more members than one read returns, so the listing stops
                      here.
                    </div>
                  {/if}
                {/if}
              </div>

              <!-- The archive's own line, directly ABOVE the footer: the crumb and its acts get a
                   full row of their own, and the footer underneath keeps every standard tool. -->
              <div class="flex items-center gap-8 border-t border-border-default px-12 py-4">
                {@render archiveCrumb()}
                <span class="ms-auto flex shrink-0 items-center gap-4">
                  {@render archiveActions()}
                </span>
              </div>

              <FileManagerFooter
                {manager}
                grid={archiveGrid}
                onUndo={() => void undoMove()}
                onRedo={() => void redoMove()}
                onUndoSteps={(steps) => void undoMoves(steps)}
                onRedoSteps={(steps) => void redoMoves(steps)}
              />
            {:else}

            {#if manager.view === "results"}
              <!-- What the results view still says for itself: how the search was scoped, how many
                   rows matched it, and how far the index actually reaches. The FIELD is not here —
                   it lives with the surface's other controls at the top, so the table's own titles
                   start in the same place in this view as in every other. -->
              <div
                class="flex items-center gap-8 border-b border-border-default px-12 py-4 text-xs text-text-muted"
              >
                <span>{countPhrase(rows.length, "match")}</span>
                <Select.Root
                  type="single"
                  items={SEARCH_SCOPES}
                  allowDeselect={false}
                  bind:value={
                    () => manager.searchScope,
                    (next) => (manager.searchScope = next as typeof manager.searchScope)
                  }
                >
                  <Select.Trigger aria-label="Search in">
                    <Select.Value placeholder={placeholderOf("Scope")} />
                  </Select.Trigger>
                  <Select.Content>
                    {#each SEARCH_SCOPES as option (option.value)}
                      <Select.Item value={option.value} label={option.label} />
                    {/each}
                  </Select.Content>
                </Select.Root>
                <label class="flex items-center gap-4">
                  <Checkbox bind:checked={manager.searchIncludesDeleted} />
                  Include deleted files
                </label>
                <span class="ms-auto flex items-center gap-4 text-text-subtle">
                  <Badge variant="neutral">Soon</Badge>
                  Names only for now: {capability("search").waitingOn}
                </span>
              </div>
            {/if}

            <FileContextMenu
              entries={menuEntries}
              {documentTypes}
              {sharedDocumentTypeId}
              {sharedColor}
              {sharedIcon}
              onCommand={(command) => void runCommand(command)}
              onPickDocumentType={(documentTypeId) => void applyDocumentTypeTo(menuTargets, documentTypeId)}
              onAddDocumentType={(name) => void addDocumentTypeFor(menuTargets, name)}
              onPickColor={(color) => {
                for (const row of menuFolderRows) {
                  if (row.kind !== "folder") continue;
                  folderAppearance = {
                    ...folderAppearance,
                    [row.folder.id]: { ...folderAppearance[row.folder.id], color },
                  };
                }
              }}
              onPickIcon={(icon) => {
                for (const row of menuFolderRows) {
                  if (row.kind !== "folder") continue;
                  folderAppearance = {
                    ...folderAppearance,
                    [row.folder.id]: { ...folderAppearance[row.folder.id], icon },
                  };
                }
              }}
            >
              <div
                class="flex min-h-0 flex-1 flex-col"
                role="presentation"
                oncontextmenu={(event) => {
                  const element =
                    event.target instanceof Element
                      ? event.target.closest("[data-grid-row]")
                      : null;
                  const key = element?.getAttribute("data-grid-row") ?? null;
                  const row = key === null ? null : rows.find((candidate) => candidate.key === key);
                  if (row === undefined || row === null) {
                    // The empty space beneath the rows is the FOLDER's menu, and it clears the
                    // selection first so what it acts on is never a row nobody is pointing at.
                    grid.clearSelection();
                    menuIsBackground = true;
                    menuTargets = [];
                    return;
                  }
                  retarget(event, row);
                }}
              >
                {#if manager.view === "deleted"}
                  <div class="flex min-h-0 flex-1 flex-col">
                    <DataTable.Grid
                      grid={deletedGrid}
                      cell={deletedCell}
                      settings={displaySettings}
                      caption="This matter's deleted files"
                      empty={emptyDeleted}
                      loading={deletedLoading}
                      density={manager.scalePercent < 100 ? "compact" : "comfortable"}
                      class="h-full rounded-none border-0"
                    />
                    {#if deletedCursor !== null}
                      <div class="border-t border-border-default px-12 py-4">
                        <Button variant="ghost" size="sm" onclick={() => void loadMoreDeleted()}>
                          Load More
                        </Button>
                      </div>
                    {/if}
                  </div>
                {:else if manager.view === "history"}
                  <div class="flex min-h-0 flex-1 flex-col">
                    <DataTable.Grid
                      grid={historyGrid}
                      settings={displaySettings}
                      caption="This matter's file changelog"
                      empty={emptyHistory}
                      loading={historyLoading}
                      density={manager.scalePercent < 100 ? "compact" : "comfortable"}
                      class="h-full rounded-none border-0"
                    />
                    {#if historyCursor !== null}
                      <div class="border-t border-border-default px-12 py-4">
                        <Button variant="ghost" size="sm" onclick={() => void loadMoreHistory()}>
                          Load More
                        </Button>
                      </div>
                    {/if}
                  </div>
                {:else if manager.listMode === "icons" && manager.view === "browse"}
                  <FileIconGrid
                    {grid}
                    {folderAppearance}
                    hideExtensions={manager.hideExtensions}
                    scalePercent={manager.scalePercent}
                    onActivate={activate}
                    onRowContextMenu={retarget}
                  />
                {:else}
                  <!-- Edge to edge: the toolbar above and the footer below already frame the list,
                       so the table-card's own rounded frame would draw a box inside a box. -->
                  <DataTable.Grid
                    {grid}
                    {cell}
                    settings={displaySettings}
                    caption="This matter's files"
                    empty={emptyFolder}
                    {loading}
                    density={manager.scalePercent < 100 ? "compact" : "comfortable"}
                    class="h-full rounded-none border-0"
                  />
                {/if}
              </div>
            </FileContextMenu>

            {#if manager.view === "deleted"}
              <FileManagerFooter
                {manager}
                grid={deletedGrid}
                onUndo={() => void undoMove()}
                onRedo={() => void redoMove()}
                onUndoSteps={(steps) => void undoMoves(steps)}
                onRedoSteps={(steps) => void redoMoves(steps)}
              />
            {:else if manager.view === "history"}
              <FileManagerFooter
                {manager}
                grid={historyGrid}
                onUndo={() => void undoMove()}
                onRedo={() => void redoMove()}
                onUndoSteps={(steps) => void undoMoves(steps)}
                onRedoSteps={(steps) => void redoMoves(steps)}
              />
            {:else}
              <FileManagerFooter
                {manager}
                {grid}
                tally={footerTally}
                extras={manager.view === "analysis" ? analysisExtras : undefined}
                onUndo={() => void undoMove()}
                onRedo={() => void redoMove()}
                onUndoSteps={(steps) => void undoMoves(steps)}
                onRedoSteps={(steps) => void redoMoves(steps)}
              />
            {/if}

            {/if}
          </div>
        </Resizable.Pane>

        <Resizable.Handle />
        <Resizable.Pane
          bind:this={inspectorPane}
          defaultSize={26}
          minSize={18}
          maxSize={44}
          collapsible
          collapsedSize={0}
          class="flex min-h-0 flex-col"
          onCollapse={() => manager.setPanelOpen(false)}
          onExpand={() => manager.setPanelOpen(true)}
        >
          {#if manager.panelOpen}
            <FileInspector
              row={inspectedRow}
              hideExtensions={manager.hideExtensions}
              {documentTypeName}
              {documentTypes}
              {versions}
              {versionsLoading}
              {integrity}
              {integrityRunning}
              folderAggregateOf={(folderId) => folderAggregate(index, folderId, safetyKeyOf)}
              bind:tab={manager.inspectorTab}
              onClose={togglePanel}
              onRename={() => {
                if (inspectedRow !== null) beginRename(inspectedRow);
              }}
              onPickDocumentType={(documentTypeId) => {
                if (inspectedRow !== null) void applyDocumentTypeTo([inspectedRow], documentTypeId);
              }}
              onAddDocumentType={(name) => {
                if (inspectedRow !== null) void addDocumentTypeFor([inspectedRow], name);
              }}
              onVerifyIntegrity={() => void runIntegrityCheck()}
              onOpenVersion={(version) => {
                if (inspectedRow?.kind === "file") {
                  globalThis.open(fileDownloadUrl(inspectedRow.file.id), "_blank", "noopener");
                }
                void version;
              }}
              onRestoreVersion={() => {
                actionFailure =
                  "Restoring an older version writes it back as a new version, which this screen " +
                  "does not run yet. Every version is still kept.";
              }}
            />
          {/if}
        </Resizable.Pane>
      </Resizable.PaneGroup>
    </div>
  {/if}
</div>

<!-- The real file picker, opened by every path that adds a file: the picker comes first, and the
     destination question follows it. -->
<input
  bind:this={filePicker}
  type="file"
  multiple
  class="sr-only"
  aria-hidden="true"
  tabindex="-1"
  onchange={(event) => {
    const chosen = event.currentTarget.files;
    void pickedFiles(chosen === null ? [] : [...chosen]);
    event.currentTarget.value = "";
  }}
/>

<UploadDestinationDialog
  bind:open={uploadOpen}
  {index}
  baseFolderId={uploadBaseFolderId}
  {matterTitle}
  items={uploadItems}
  confirmed={uploadConfirmed}
  onConfirm={(destinationFolderId) => void confirmUploadDestination(destinationFolderId)}
  onClose={() => {
    uploadOpen = false;
    reload();
  }}
/>

<RestoreFileDialog
  bind:open={restoreOpen}
  {index}
  file={restoreTarget}
  running={restoreRunning}
  failure={restoreFailure}
  onConfirm={(destination) => void confirmRestore(destination)}
  onCancel={() => {
    restoreOpen = false;
    restoreTarget = null;
  }}
/>

<FolderDeleteDialog
  bind:open={folderDeleteOpen}
  {index}
  folder={folderToDelete}
  running={folderDeleteRunning}
  failure={folderDeleteFailure}
  onConfirm={(choice) => void confirmFolderDelete(choice)}
  onCancel={() => {
    folderDeleteOpen = false;
    folderToDelete = null;
  }}
/>

{#snippet deletedCell({ row, column, text }: DataTable.GridCellContext<DeletedFileSummary>)}
  {#if column.id === "name"}
    <span class="flex min-w-0 items-center gap-8">
      <FileIcon
        contentType={row.sniffedContentType ?? undefined}
        fileName={row.name}
        class="size-16 shrink-0"
      />
      <span class="truncate">{text}</span>
    </span>
  {:else if column.id === "deleted"}
    <span class="whitespace-nowrap">{text}</span>
  {:else if column.id === "restore"}
    <Button variant="secondary" size="sm" onclick={() => beginRestore(row)}>Restore</Button>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet archiveCell({ row, column, text }: DataTable.GridCellContext<ArchiveRow>)}
  {#if column.id === "name"}
    <span class="flex min-w-0 items-center gap-8">
      {#if row.kind === "directory"}
        <FileIcon folder class="size-16 shrink-0" />
      {:else}
        <FileIcon fileName={row.name} class="size-16 shrink-0" />
      {/if}
      <span class="truncate">{text}</span>
    </span>
  {:else if column.id === "modified"}
    <span class="whitespace-nowrap">{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet emptyArchive()}
  <EmptyState title="Nothing to List">
    This archive's directory names no members at this level. The file itself is unchanged — browsing
    reads, it never extracts.
  </EmptyState>
{/snippet}

<!-- The archive's place marker: the zip itself, then each directory down to the level shown. It
     lives on the archive's own line above the footer, so entering a zip never moves the header
     and never costs the footer a tool. -->
{#snippet archiveCrumb()}
  {#if archiveBrowse !== null}
    <!-- The crumb is the line's one YIELDING element, and it yields in a hierarchy: past two
         levels the middle collapses to an ellipsis, then the zip's name and the middle segment give
         way to ellipses — the level being SHOWN never disappears. Every title carries the full
         name, and the clip backstop means the crumb can never paint over the acts beside it. -->
    {@const segments = archivePathSegments(archivePath)}
    {@const shownSegments = segments.length > 2 ? segments.slice(-2) : segments}
    {@const currentSegment = shownSegments.at(-1)}
    <span class="flex min-w-0 items-center gap-4 overflow-hidden">
      <FileArchive class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
      <Button
        variant="ghost"
        size="sm"
        class="min-w-0"
        aria-pressed={archivePath === ""}
        title={displayName(archiveBrowse.fileName, manager.hideExtensions)}
        onclick={() => (archivePath = "")}
      >
        <span class="min-w-0 truncate" style="max-inline-size: var(--mc-size-popover)">
          {displayName(archiveBrowse.fileName, manager.hideExtensions)}
        </span>
      </Button>
      {#if segments.length > shownSegments.length}
        <span class="shrink-0 text-text-subtle" aria-hidden="true">/ …</span>
      {/if}
      {#each shownSegments as segment (segment.path)}
        <span class="shrink-0 text-text-subtle" aria-hidden="true">/</span>
        <Button
          variant="ghost"
          size="sm"
          class={segment === currentSegment ? "shrink-0" : "min-w-0"}
          aria-pressed={segment.path === archivePath}
          title={segment.name}
          onclick={() => (archivePath = segment.path)}
        >
          <span class="min-w-0 truncate" style="max-inline-size: var(--mc-size-popover)">
            {segment.name}
          </span>
        </Button>
      {/each}
      {#if archiveBrowse.deleted}
        <Badge
          variant="neutral"
          title="This zip sits in Deleted Files. Browsing reads it; nothing is restored."
        >
          Deleted
        </Badge>
      {/if}
      {#if archiveBrowse.unscanned}
        {@const notScanned = statusEntry("not-scanned")}
        <Badge
          variant={notScanned.tone}
          title="This archive has not come back clean from the safety check yet. Its directory reads all the same; treat what it names accordingly."
        >
          {notScanned.label}
        </Badge>
      {/if}
    </span>
  {/if}
{/snippet}

{#snippet archiveActions()}
  <Button variant="secondary" size="sm" disabled title={waitingReason("archive-extract")}>
    Extract Into This Matter
    <Badge variant="neutral">Soon</Badge>
  </Button>
  <Button
    variant="ghost"
    size="icon"
    title="Close the archive"
    aria-label="Close the archive"
    onclick={leaveArchive}
  >
    <X class="size-16" aria-hidden="true" />
  </Button>
{/snippet}

<!-- File Analysis's own acts ride the footer beside undo/redo: the view needs no header strip of
     its own — the Safety column filters, and the footer already counts. -->
{#snippet analysisExtras()}
  {#if ignoredIssueList.length > 0 || showingIgnored}
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={showingIgnored}
      onclick={() => (showingIgnored = !showingIgnored)}
    >
      {#if showingIgnored}
        <Eye class="size-16" aria-hidden="true" />
        Show Open Issues
      {:else}
        <EyeOff class="size-16" aria-hidden="true" />
        Show {countPhrase(ignoredIssueList.length, "Ignored Issue")}
      {/if}
    </Button>
  {/if}
  <Button
    variant="ghost"
    size="icon"
    title="Download every issue shown"
    aria-label="Download every issue shown"
    onclick={downloadIssueReport}
  >
    <Download class="size-16" aria-hidden="true" />
  </Button>
{/snippet}

{#snippet emptyDeleted()}
  <EmptyState title="Nothing Has Been Deleted">
    Deleting a file here is a soft delete: the bytes and every version stay, and this is where they
    come back from.
  </EmptyState>
{/snippet}

{#snippet emptyHistory()}
  <EmptyState title="Nothing Has Happened Yet">
    Every act on this matter's files lands here as it happens: time, action, file, and source.
  </EmptyState>
{/snippet}

{#snippet railMenuItems(target: FolderTreeMenuTarget)}
  {@const row = railRowOf(target.folderId)}
  {#if row !== null && row.kind === "folder"}
    <ContextMenu.Item onSelect={() => manager.openFolder(row.folder.id)}>Open</ContextMenu.Item>
    <ContextMenu.Item onSelect={() => download([row])}>Download</ContextMenu.Item>
    <ContextMenu.Separator />
    <ContextMenu.Item onSelect={() => manager.setPinned([row.key], !manager.isPinned(row.key))}>
      {manager.isPinned(row.key) ? "Unpin" : "Pin to Top"}
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => renameFromRail(row)}>Rename</ContextMenu.Item>
    <ContextMenu.Separator />
    <ContextMenu.Item disabled title={waitingReason("copy-paste")}>
      Copy
      <Badge variant="neutral" class="ms-auto">Soon</Badge>
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => manager.mark([row.key], "cut")}>Cut</ContextMenu.Item>
    <ContextMenu.Item
      disabled={manager.clipboard === null}
      title={manager.clipboard === null ? "Nothing is on the clipboard yet." : undefined}
      onSelect={() => void pasteIntoFolder(row.folder.id)}
    >
      Paste
    </ContextMenu.Item>
    <ContextMenu.Separator />
    <ContextMenu.Item onSelect={() => void deleteRows([row])}>Delete</ContextMenu.Item>
  {:else}
    <!-- Home is a destination, not a folder: it opens, and it takes a paste; there is nothing on
         it to rename, colour, or delete. -->
    <ContextMenu.Item onSelect={() => manager.openFolder(null)}>Open</ContextMenu.Item>
    <ContextMenu.Item
      disabled={manager.clipboard === null}
      title={manager.clipboard === null ? "Nothing is on the clipboard yet." : undefined}
      onSelect={() => void pasteIntoFolder(null)}
    >
      Paste
    </ContextMenu.Item>
  {/if}
{/snippet}

{#snippet displaySettings()}
  <!-- The surface's own display settings ride the header menu's Columns submenu, in the same
       family as the zebra setting and beside the columns they change. -->
  <ContextMenu.CheckboxItem
    bind:checked={() => manager.hideExtensions, (next) => manager.setHideExtensions(next)}
  >
    Hide file extensions
  </ContextMenu.CheckboxItem>
  <ContextMenu.CheckboxItem
    bind:checked={() => manager.showSidebarCounts, (next) => manager.setShowSidebarCounts(next)}
  >
    Show file counts in the sidebar
  </ContextMenu.CheckboxItem>
{/snippet}

{#snippet emptyFolder()}
  <EmptyState title="Nothing in This Folder">
    Files put here appear in this list. Everything on the matter is still reachable from Home,
    whichever folder it sits in.
    {#snippet actions()}
      <Button onclick={() => filePicker?.click()}>
        <Upload class="size-16" aria-hidden="true" />
        Upload a File
      </Button>
      <Button variant="secondary" disabled={newFolderPending} onclick={() => void makeFolder()}>
        <Plus class="size-16" aria-hidden="true" />
        New Folder
      </Button>
    {/snippet}
  </EmptyState>
{/snippet}

{#snippet cell({ row, column, text }: DataTable.GridCellContext<FileManagerRow>)}
  {#if column.id === "name"}
    <span class="flex min-w-0 items-center gap-8">
      {#if row.kind === "folder"}
        <!-- The folder's own colour and mark, the same glyph the rail draws: a colour that showed
             in one place and not the other read as a colour that had not saved. -->
        <FolderGlyph
          class="size-16 shrink-0"
          color={folderAppearance[row.folder.id]?.color}
          icon={folderAppearance[row.folder.id]?.icon}
        />
      {:else}
        <FileIcon
          contentType={row.file.sniffedContentType ?? undefined}
          fileName={row.file.name}
          class="size-16 shrink-0"
        />
      {/if}
      {#if manager.renamingKey === row.key}
        <!-- The extension is never selected, and never shown while extensions are hidden: the
             field simply does not contain what must not be edited by accident. -->
        <span class="flex min-w-0 flex-col gap-4">
          <Input
            size="sm"
            bind:value={renameDraft}
            aria-label="New name"
            aria-invalid={renameConflict !== null}
            onkeydown={(event: KeyboardEvent) => {
              if (event.key === "Enter") void commitRename(row);
            }}
            onblur={() => void commitRename(row)}
          />
          {#if renameConflict !== null}
            <span class="text-xs text-status-danger">{renameConflict}</span>
          {/if}
        </span>
      {:else}
        <span class="truncate">{text}</span>
      {/if}
    </span>
  {:else if column.id === "safety"}
    {#if row.kind === "folder"}
      <SafetyMark verdict={folderAggregate(index, row.folder.id, safetyKeyOf).safety} />
    {:else}
      <SafetyMark verdict={safetyKeyOf(row.file)} />
    {/if}
  {:else if column.id === "version"}
    <!-- A bare number, and NOT tabular: "12" must not read as "1 2". -->
    <span>{text}</span>
  {:else if column.id === "fileType"}
    <span class="font-mono text-xs">{row.kind === "folder" ? "" : fileExtension(row.file)}</span>
  {:else if column.id === "modified" || column.id === "created"}
    <span class="whitespace-nowrap">{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}
