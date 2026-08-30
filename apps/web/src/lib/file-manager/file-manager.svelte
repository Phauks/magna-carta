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
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Resizable from "@magna-carta/design-system/resizable";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import FolderTree from "@magna-carta/design-system/folder-tree";
  import Input from "@magna-carta/design-system/input";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import * as Select from "@magna-carta/design-system/select";
  import { formatInstant, placeholderOf } from "@magna-carta/design-system/formatters";
  import type {
    FolderColorName,
    FolderIconName,
    FolderTreeNode,
    FolderTreeView,
  } from "@magna-carta/design-system/folder-tree";
  import FileSearch from "@lucide/svelte/icons/file-search";
  import History from "@lucide/svelte/icons/history";
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
    type FolderSummary,
  } from "./folder-api.ts";
  import {
    createDocumentType,
    fileDownloadUrl,
    listDocumentTypes,
    listFileVersions,
    listMatterFiles,
    verifyFileIntegrity,
    type DocumentTypeSummary,
    type IntegrityVerification,
    type MatterFile,
    type MatterFileVersion,
  } from "./matter-file-api.ts";
  import { uploadIntoFolder, type UploadStage } from "./file-upload.ts";
  import {
    MatterFileIndex,
    fileKey,
    folderKey,
    type FileManagerRow,
    folderAggregate,
  } from "./file-rows.ts";
  import { browseColumns, locatedColumns, safetyKeyOf, fileExtension } from "./file-columns.ts";
  import {
    collidingSibling,
    committedRename,
    disambiguated,
    displayName,
    renameConflictMessage,
    renameFieldValue,
    splitName,
  } from "./file-names.ts";
  import {
    countPhrase,
    ISSUE_KINDS,
    type IssueKind,
    type SeverityBandKey,
  } from "./file-manager-vocabulary.ts";
  import {
    allIssues,
    countsByBand,
    countsByKind,
    issueKey,
    issueReportText,
    issuesOnFile,
    type Issue,
  } from "./file-analysis.ts";
  import { capability } from "./file-manager-availability.ts";
  import { backgroundMenu, rowMenu, type FileMenuCommand } from "./file-menu-model.ts";
  import { FileManagerState, type FileManagerView } from "./file-manager-state.svelte.ts";
  import FileManagerToolbar from "./file-manager-toolbar.svelte";
  import FileManagerFooter from "./file-manager-footer.svelte";
  import FileContextMenu from "./file-context-menu.svelte";
  import FileIconGrid from "./file-icon-grid.svelte";
  import FileInspector from "./file-inspector.svelte";
  import FolderDeleteDialog from "./folder-delete-dialog.svelte";
  import UploadDestinationDialog from "./upload-destination-dialog.svelte";
  import SafetyMark from "./safety-mark.svelte";
  import FileAnalysisBar from "./file-analysis-bar.svelte";
  import DocumentTypeMenu from "./document-type-menu.svelte";

  let { matterId }: { matterId: string } = $props();

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
  let analysisBand = $state<SeverityBandKey | null>(null);
  let analysisKind = $state<IssueKind | null>(null);
  let showingIgnored = $state(false);

  const everyIssue = $derived(allIssues(files ?? []));
  const openIssues = $derived(everyIssue.filter((issue) => !ignoredIssues.has(issueKey(issue))));
  const ignoredIssueList = $derived(
    everyIssue.filter((issue) => ignoredIssues.has(issueKey(issue))),
  );
  /** The issues the view is currently showing: the open/ignored choice, then the two narrowings. */
  const shownIssues = $derived.by((): readonly Issue[] => {
    const base = showingIgnored ? ignoredIssueList : openIssues;
    return base
      .filter((issue) => analysisBand === null || ISSUE_KINDS[issue.kind].band === analysisBand)
      .filter((issue) => analysisKind === null || issue.kind === analysisKind);
  });
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

  function activate(row: FileManagerRow): void {
    if (row.kind === "folder") {
      manager.openFolder(row.folder.id);
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
      reload();
      return;
    }
    actionFailure = "That folder could not be made.";
  }

  // --- renaming ------------------------------------------------------------------------------------

  let renameDraft = $state("");
  let renameConflict = $state<string | null>(null);

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
        ? await patchFolder(fetch, row.folder.id, { name: wanted })
        : await patchFile(fetch, row.file.id, { name: wanted });
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
        const outcome = await patchFolder(fetch, row.folder.id, {
          parentFolderId: destinationFolderId,
        });
        results.push(outcome.kind === "ok");
      } else {
        origins.set(key, row.file.folderId);
        const outcome = await patchFile(fetch, row.file.id, { folderId: destinationFolderId });
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
      if (row.kind === "folder") await patchFolder(fetch, row.folder.id, { parentFolderId: origin });
      else await patchFile(fetch, row.file.id, { folderId: origin });
    }
    reload();
  }

  async function redoMove(): Promise<void> {
    const move = manager.moves.takeRedo();
    manager.moveRevision += 1;
    if (move === null) return;
    for (const key of move.keys) {
      const row = findRowAnywhere(key);
      if (row === null) continue;
      if (row.kind === "folder") {
        await patchFolder(fetch, row.folder.id, { parentFolderId: move.destinationFolderId });
      } else {
        await patchFile(fetch, row.file.id, { folderId: move.destinationFolderId });
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
        const outcome = await deleteFolderRequest(fetch, only.folder.id);
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
      fileRows.map((row) => (row.kind === "file" ? deleteFile(fetch, row.file.id) : null)),
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
        const outcome = await patchFile(fetch, file.id, {
          folderId: choice.destinationFolderId,
        });
        if (outcome.kind !== "ok") trouble = true;
      }
      for (const folderId of index.childrenOf(target.id).map((folder) => folder.id)) {
        const outcome = await patchFolder(fetch, folderId, {
          parentFolderId: choice.destinationFolderId,
        });
        if (outcome.kind !== "ok") trouble = true;
      }
    } else {
      for (const file of held) {
        const outcome = await deleteFile(fetch, file.id);
        if (outcome.kind !== "ok") trouble = true;
      }
      // Deepest first, because a folder cannot go while it still holds one.
      for (const folderId of descendants.toReversed()) {
        const outcome = await deleteFolderRequest(fetch, folderId);
        if (outcome.kind !== "ok") trouble = true;
      }
    }

    if (!trouble) {
      const outcome = await deleteFolderRequest(fetch, target.id);
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
    const fileRows = targets.filter(
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

  let filePicker = $state<HTMLInputElement | null>(null);
  let pendingUploads = $state<readonly File[]>([]);
  let uploadOpen = $state(false);
  let uploadRunning = $state(false);
  let uploadStage = $state<UploadStage | null>(null);
  let uploadCompleted = $state(0);
  let uploadFailures = $state<readonly { name: string; reason: string }[]>([]);

  function offerUpload(chosen: readonly File[]): void {
    if (chosen.length === 0) return;
    pendingUploads = chosen;
    uploadFailures = [];
    uploadCompleted = 0;
    uploadStage = null;
    uploadOpen = true;
  }

  async function runUploads(destinationFolderId: string | null): Promise<void> {
    uploadRunning = true;
    uploadCompleted = 0;
    const failures: { name: string; reason: string }[] = [];
    const taken = index
      .filesIn(destinationFolderId)
      .map((file) => ({ key: fileKey(file.id), name: file.name }));

    for (const file of pendingUploads) {
      // An upload that lands on a name already taken disambiguates in the copy convention: the
      // reader asked for this file to be here, and refusing it would be the worse answer.
      const name = disambiguated(file.name, taken);
      const outcome = await uploadIntoFolder({
        fetchImpl: fetch,
        matterId,
        folderId: destinationFolderId,
        file,
        name,
        onStage: (stage) => (uploadStage = stage),
      });
      taken.push({ key: `pending:${name}`, name });
      uploadCompleted += 1;
      if (outcome.kind === "problem") {
        failures.push({ name: file.name, reason: problemGuidance(outcome.problem).message });
      } else if (outcome.kind === "transport") {
        failures.push({ name: file.name, reason: "Nothing answered while " + outcome.stage + "." });
      }
    }

    uploadRunning = false;
    uploadFailures = failures;
    if (failures.length === 0) {
      uploadOpen = false;
      pendingUploads = [];
      // The upload landed where it was asked to land, so show that folder.
      if (destinationFolderId !== manager.currentFolderId) manager.openFolder(destinationFolderId);
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

  async function copyIssueReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(analysisReport);
    } catch {
      // A browser that refuses clipboard access is not a failure worth a banner: the same text is
      // one press away through Download, which needs no permission.
      actionFailure = "The report could not be copied. Download produces the same text.";
    }
  }

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
        row.kind === "file" ? patchFile(fetch, row.file.id, { documentTypeId }) : null,
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
</script>

<svelte:window onkeydown={onKeyDown} />

<!-- The height is explicit because the shell's main is a block container: a flex child of a block
     parent sizes to its content, so `flex: 1` alone stretched nothing and the three panes collapsed
     to the height of the shortest one. -->
<div class="flex h-full min-h-0 flex-col">
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
    <FileManagerToolbar {manager} {grid} {trail} viewTitle={VIEW_TITLES[manager.view]} />

    {#if actionFailure !== null}
      <div class="px-16 pt-12">
        <Alert.Root variant="warning">
          <Alert.Title>That Did Not Go Through</Alert.Title>
          <Alert.Description>{actionFailure}</Alert.Description>
        </Alert.Root>
      </div>
    {/if}

    <div class="min-h-0 flex-1">
      <Resizable.PaneGroup direction="horizontal" autoSaveId="matter-files-panes">
        {#if manager.railOpen}
          <Resizable.Pane defaultSize={20} minSize={12} maxSize={36}>
            <FolderTree
              class="h-full"
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
            />
          </Resizable.Pane>
          <Resizable.Handle withHandle />
        {/if}

        <Resizable.Pane defaultSize={54} minSize={30}>
          <div
            class="flex h-full min-h-0 flex-col"
            role="presentation"
            data-dragover={dragOver ? "true" : undefined}
            ondragenter={(event) => {
              event.preventDefault();
              dragDepth += 1;
            }}
            ondragover={(event) => event.preventDefault()}
            ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
            ondrop={(event) => {
              event.preventDefault();
              dragDepth = 0;
              const dropped = event.dataTransfer?.files;
              if (dropped && dropped.length > 0) offerUpload([...dropped]);
            }}
          >
            {#if manager.view === "analysis"}
              <FileAnalysisBar
                countsByBand={countsByBand(showingIgnored ? ignoredIssueList : openIssues)}
                countsByKind={countsByKind(showingIgnored ? ignoredIssueList : openIssues)}
                bind:activeBand={analysisBand}
                bind:activeKind={analysisKind}
                bind:showingIgnored
                ignoredCount={ignoredIssueList.length}
                onCopyReport={() => void copyIssueReport()}
                onDownloadReport={downloadIssueReport}
              />
            {/if}

            {#if manager.view === "results"}
              <!-- The results view's own header: the field where the view is named, the match count
                   beside it, and the index's standing pulled to the far edge. It sits ABOVE the
                   table, so a search that returns thirty rows does not push it down the page. -->
              <div class="flex items-center gap-8 border-b border-border-default px-12 py-8">
                <ScreenSearch
                  bind:value={manager.searchQuery}
                  expanded
                  size="sm"
                  label="Search this matter"
                  matchSummary={countPhrase(rows.length, "match")}
                  shortcut={null}
                >
                  {#snippet scope()}
                    <!-- The vocabulary names the matter and no wider: searching everything is the
                         top bar's job, not this control's. -->
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
                  {/snippet}
                </ScreenSearch>
                <label class="flex items-center gap-4 text-xs text-text-muted">
                  <Checkbox bind:checked={manager.searchIncludesDeleted} />
                  Include deleted files
                </label>
                <span class="ms-auto flex items-center gap-4 text-xs text-text-subtle">
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
                {#if manager.view === "deleted" || manager.view === "history"}
                  <!-- The view opens and states its case in full rather than being a row nobody
                       can press. Its own columns are designed and not built, so it does not borrow
                       the browse table's: an empty table under somebody else's headings would be a
                       half-truth about what is coming. -->
                  <div class="mc-scrollbar min-h-0 flex-1 overflow-y-auto p-16">
                    <Alert.Root variant="info">
                      <Alert.Title>
                        {VIEW_TITLES[manager.view]}
                        <Badge variant="neutral" class="ms-8">Soon</Badge>
                      </Alert.Title>
                      <Alert.Description>
                        <span class="block">
                          {capability(manager.view === "deleted" ? "deleted-files" : "history")
                            .waitingOn}
                        </span>
                        <span class="mt-4 block">
                          {#if manager.view === "deleted"}
                            Deleting a file here is a soft delete: the bytes and every version stay,
                            and this is where they come back from.
                          {:else}
                            Every act on this matter's files is already audited. This is where it
                            becomes readable: time, action, file, from, to, and source.
                          {/if}
                        </span>
                      </Alert.Description>
                    </Alert.Root>
                  </div>
                {:else if manager.listMode === "icons" && manager.view === "browse"}
                  <FileIconGrid
                    {grid}
                    hideExtensions={manager.hideExtensions}
                    scalePercent={manager.scalePercent}
                    onActivate={activate}
                    onRowContextMenu={retarget}
                  />
                {:else}
                  <DataTable.Grid
                    {grid}
                    {cell}
                    caption="This matter's files"
                    empty={emptyFolder}
                    {loading}
                    density={manager.scalePercent < 100 ? "compact" : "comfortable"}
                    class="h-full"
                  />
                {/if}
              </div>
            </FileContextMenu>

            <FileManagerFooter
              {manager}
              {grid}
              onUndo={() => void undoMove()}
              onRedo={() => void redoMove()}
            />
          </div>
        </Resizable.Pane>

        {#if manager.panelOpen}
          <Resizable.Handle withHandle />
          <Resizable.Pane defaultSize={26} minSize={18} maxSize={44}>
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
              onClose={() => manager.setPanelOpen(false)}
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
          </Resizable.Pane>
        {/if}
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
  currentFolderId={manager.view === "browse" ? manager.currentFolderId : null}
  files={pendingUploads}
  running={uploadRunning}
  stage={uploadStage}
  completed={uploadCompleted}
  failures={uploadFailures}
  onConfirm={(destinationFolderId) => void runUploads(destinationFolderId)}
  onCancel={() => {
    uploadOpen = false;
    pendingUploads = [];
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
        <FileIcon folder class="size-16 shrink-0" />
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
    <span class="whitespace-nowrap">
      {#if row.kind === "folder" && column.id === "created"}
        <!-- A folder has no creation stamp of its own on the record, so the cell is blank rather
             than borrowing one from its contents. -->
      {:else}
        {text === "" ? "" : formatInstant(text)}
      {/if}
    </span>
  {:else}
    {text}
  {/if}
{/snippet}
