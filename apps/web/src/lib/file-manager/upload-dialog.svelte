<script lang="ts">
  /*
   * The Upload dialog — intake on the left, source on the right, and the one press that sends.
   *
   * TWO SIDES, TWO JOBS. The LEFT is the INTAKE: what the arriving files become — which matter and
   * folder they land in, how they are dated. It is read top to bottom once and then left alone.
   * The RIGHT is the SOURCE: the files and folders themselves, as the product's one table, nested
   * the way they sit on the reader's disk, filterable from its header, each row saying where it
   * stands. They belong apart because they move at different speeds — the intake is decided once,
   * the source changes every second while bytes move — and the owner's ruling (2026-09-06) put the
   * intake on the left and the source on the right.
   *
   * THE LEFT IS TABS. Location first — the matter and the folder, the two answers every upload
   * gives — and Advanced Settings second, holding what has a right default. Tabs rather than one
   * stacked form because they are the modular shape: a third tab arrives later without the panel
   * being redesigned around it, and a setting nobody needs today costs the reader nothing to scroll
   * past. Advanced Settings used to fold shut beneath the location as an accordion, and opening it
   * pushed the panel taller under the pointer (owner's ruling, 2026-09-09).
   *
   * THE FRAME HOLDS STILL. The panel opens at one height for the screen it is on — a share of the
   * viewport, capped at a comfortable measure, the same rule the record windows keep — and never
   * grows to meet what is put in it. Opening a tab, adding a folder of four hundred files, or
   * unfolding an intake folder moves nothing already on screen: the panes scroll inside the room
   * they have. The measure is pinned on the source pane, which is the side whose content the reader
   * changes; the intake beside it takes the same height by construction.
   *
   * NOTHING IS SENT UNTIL UPLOAD IS PRESSED. Choose (dropped anywhere on the source pane, or
   * through the one Add control), decide where they go, press Upload. Cancelling before that sends
   * nothing, so there is nothing to un-save — and because choosing is work, leaving with files
   * chosen asks first, whether the reader leaves by the panel's own exits or by navigating away
   * from the screen beneath it.
   *
   * ONE ADD CONTROL, A REAL BUTTON, NAMING BOTH CHOICES. Add is the design system's button wearing
   * the design system's menu, and the menu says "File" and "Folder" outright, so neither choice is
   * discoverable only by pressing and finding out. No engine offers a picker that takes files and
   * folders together — the two are separate calls in every browser API there is — which is why
   * they are two items; the drop takes any mix at once and needs no picker at all. Where the engine
   * has the File System Access pickers they are used in preference to a hidden `<input>`: an
   * `<input webkitdirectory>` makes the browser raise its OWN confirmation over ours ("Upload 240
   * files to this site?"), a second question about a choice the reader has just made, in a dialog
   * we neither control nor word. The API's pickers raise none.
   *
   * EVERY FILE SAYS WHETHER IT IS READY. A chosen file's digest is what lets the firm answer "we
   * already hold these bytes" before any of them move, and it is read by the register
   * (upload-digests.svelte.ts) from the moment the file is chosen — while the reader is still
   * deciding where it goes. The Status column reports the read as it goes and then what it found:
   * Ready, Held (the firm has these bytes, so nothing will be sent for it), or Not read. The read
   * is unconditional. There used to be a setting that turned it off, and with it any way of saying
   * a file was ready; a file the firm already holds is simply never sent again.
   *
   * A DOCUMENT TYPE IS A FACT ABOUT A FILE, NOT ABOUT A BATCH. The panel used to carry one
   * classification for everything in it, which is wrong about every folder a firm actually has:
   * discovery holds correspondence, pleadings and exhibits together. The type is a COLUMN on the
   * source table instead, set on whatever rows are selected, so one batch files as many kinds.
   *
   * NOTHING MOVES WHEN UPLOAD IS PRESSED. Every control stays where it is and is disabled; the
   * source table stays the same table, and only its Status column changes — and even that column
   * carries on from where it was, because the batch starts every file at the readiness the panel
   * was showing. The header row above the table carries the chosen count before the press and the
   * running tally after it, in the same place at the same height.
   *
   * THE TRANSFER OUTLIVES THE PANEL. Upload hands the batch to the upload queue and the panel stays
   * open to show it running — but it is a report, not a leash: Close leaves the bytes moving, the
   * top-bar upload tray keeps showing them, and the file list re-reads when they land.
   */
  import { beforeNavigate, goto } from "$app/navigation";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import Progress from "@magna-carta/design-system/progress";
  import {
    entriesFromDataTransfer,
    entriesFromFileList,
    nativeDirectoryPickerAvailable,
    nativeFilePickerAvailable,
    pickFiles,
    pickFolder,
    type DroppedEntry,
    folderPathOf,
  } from "@magna-carta/design-system/dropzone";
  import Ban from "@lucide/svelte/icons/ban";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Tag from "@lucide/svelte/icons/tag";
  import Files from "@lucide/svelte/icons/files";
  import X from "@lucide/svelte/icons/x";
  import { collidingSibling } from "./file-names.ts";
  import { formatBytes, MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";
  import { listMatterFolders } from "./folder-api.ts";
  import { listMatterFiles, type DocumentTypeSummary } from "./matter-file-api.ts";
  import {
    addIntakeEntries,
    intakeBytes,
    intakeEntryKey,
    intakeFolderPaths,
    intakeKeysOfRows,
    intakePhrase,
    removeIntakeRows,
    NAME_CLASH_LABEL,
    NAME_CLASH_ORDER,
    type IntakeProgress,
    type NameClashChoice,
  } from "./upload-intake.ts";
  import { beginDigests, forgetDigests, intakeReadiness } from "./upload-digests.svelte.ts";
  import UploadSourceTable from "./upload-source-table.svelte";
  import {
    batchCountsText,
    batchPaceText,
    cancelUploadBatch,
    retryFailedUploads,
    unsentCount,
    type UploadBatch,
    type UploadBatchPlan,
  } from "./upload-queue.svelte.ts";
  import UploadMatterPicker from "./upload-matter-picker.svelte";

  let {
    open = $bindable(false),
    matterId,
    matterTitle,
    /** The matter on screen: its folders and files, for the default destination and its names. */
    index,
    /** The folder the reader is standing in — the default upload location. */
    baseFolderId,
    /** The firm's document types, for the type a batch may carry. */
    documentTypes,
    /** Files the dialog opens already holding — what was dropped onto the list. */
    preselected,
    /** Hand the decided batch to the upload queue; returns the batch the panel then reports on. */
    onStart,
    onDismiss,
  }: {
    open?: boolean;
    matterId: string;
    matterTitle: string;
    index: MatterFileIndex;
    baseFolderId: string | null;
    documentTypes: readonly DocumentTypeSummary[];
    preselected: readonly DroppedEntry[];
    onStart: (plan: UploadBatchPlan) => UploadBatch;
    onDismiss: () => void;
  } = $props();

  const fieldPrefix = $props.id();

  /*
   * The height the panel holds, whatever is put in it: a share of the viewport, capped at the
   * measure the record windows cap at (five-eighths of the record width), so it neither overflows a
   * laptop nor wastes a monitor. The modal stage still caps the whole frame at the screen less its
   * gutter, and the pane shrinks to fit inside that rather than pushing the frame past it.
   */
  const PANE_BLOCK_SIZE = "min(72vh, calc(var(--mc-size-record-window) * 0.625))";

  // ---- the intake ---------------------------------------------------------------------------------

  type FolderChoice = "here" | "root" | "other";
  type Destination = { id: string; title: string; label: string };

  /** Which tab of the intake is showing. Location first, every time the panel opens. */
  let intakeTab = $state("location");
  let destination = $state<Destination>({ id: "", title: "", label: "" });
  let folderChoice = $state<FolderChoice>("here");
  let pickedFolderId = $state<string | null>(null);
  let createdAtBasis = $state<"source" | "upload">("source");
  /** The document type each chosen file carries, by intake key. Absent is "none", the default. */
  let documentTypeIds = $state<Map<string, string | null>>(new Map());
  /**
   * What happens to a file whose name is already taken where it lands: the batch-wide answer, and
   * any file the reader answered for on its own. Keeping both is the default — a numbered name is
   * the one outcome that loses nothing and asks nothing later.
   */
  let nameClashDefault = $state<NameClashChoice>("keep-both");
  let nameClashChoices = $state<Map<string, NameClashChoice>>(new Map());

  const liveDocumentTypes = $derived(documentTypes.filter((type) => type.deactivatedAt === null));
  const documentTypeNames = $derived(new Map(documentTypes.map((type) => [type.id, type.name])));
  /** What one chosen file's classification is called, for the source table's own column. */
  function documentTypeName(key: string): string {
    const chosen = documentTypeIds.get(key);
    return chosen == null ? "" : (documentTypeNames.get(chosen) ?? "");
  }

  /** The other matter's folders and files, read when the destination leaves the matter on screen. */
  let otherIndex = $state<MatterFileIndex | null>(null);
  let otherLoading = $state(false);
  let otherFailure = $state<string | null>(null);

  const sameMatter = $derived(destination.id === matterId);
  const destinationIndex = $derived(sameMatter ? index : otherIndex);

  $effect(() => {
    const target = destination.id;
    if (target === "" || target === matterId) {
      otherIndex = null;
      otherFailure = null;
      otherLoading = false;
      return;
    }
    let cancelled = false;
    otherLoading = true;
    otherFailure = null;
    void (async () => {
      const [folderResult, fileResult] = await Promise.all([
        listMatterFolders(fetch, target),
        listMatterFiles(fetch, target),
      ]);
      if (cancelled) return;
      otherLoading = false;
      if (folderResult.kind !== "ok" || fileResult.kind !== "ok") {
        otherFailure = "That matter's folders could not be read. Files can still go to its Home.";
        otherIndex = new MatterFileIndex([], []);
        return;
      }
      otherIndex = new MatterFileIndex(folderResult.value.data, fileResult.value.data);
    })();
    return () => {
      cancelled = true;
    };
  });

  const hereName = $derived(
    sameMatter && baseFolderId !== null ? index.pathText(baseFolderId) : null,
  );
  const destinationFolderId = $derived(
    folderChoice === "here" && sameMatter
      ? baseFolderId
      : folderChoice === "other"
        ? pickedFolderId
        : null,
  );
  const destinationLabel = $derived(
    destinationIndex === null ? "Home" : destinationIndex.pathText(destinationFolderId),
  );

  // Leaving the matter on screen takes the "current folder" answer with it.
  $effect(() => {
    if (!sameMatter && folderChoice === "here") folderChoice = "root";
  });

  // ---- the source ---------------------------------------------------------------------------------

  let entries = $state<DroppedEntry[]>([]);
  /** The folder paths showing their contents. Every folder opens on arrival; the reader folds. */
  let expanded = $state<Set<string>>(new Set());
  /** The batch, once Upload has been pressed. Null while the reader is still choosing. */
  let batch = $state<UploadBatch | null>(null);

  const started = $derived(batch !== null);
  /*
   * How each file is doing. Once a batch exists it is the batch's own answer. BEFORE that, it is
   * the digest register's: each file's readiness — being read, read and ready, held by the firm,
   * or not readable — in the same Status column and the same words it will use once the transfer
   * runs, so the reader watches one thing throughout rather than a column that comes to life only
   * after the press.
   */
  const progress = $derived.by(
    (): ReadonlyMap<string, IntakeProgress> => batch?.progress ?? intakeReadiness(entries),
  );

  /*
   * Reading begins at the CHOICE, and the firm is asked against the matter the files are bound for.
   * The register is idempotent per file, so re-running as the list grows starts only what is new.
   */
  $effect(() => {
    beginDigests(entries, destination.id === "" ? matterId : destination.id);
  });

  function add(incoming: readonly DroppedEntry[]): void {
    if (started || incoming.length === 0) return;
    entries = addIntakeEntries(entries, incoming);
    expanded = new Set([...expanded, ...intakeFolderPaths(incoming)]);
  }

  /** The rows the reader has selected in the source table, for Remove Selected. */
  let selectedKeys = $state<readonly string[]>([]);
  let sourceTable = $state<UploadSourceTable | null>(null);

  function removeSelected(): void {
    if (started) return;
    // The reads for what is being removed are abandoned: the reader has said these files are not
    // going, and a read still running for them is work nobody asked for.
    forgetDigests(intakeKeysOfRows(entries, selectedKeys));
    entries = removeIntakeRows(entries, selectedKeys);
    sourceTable?.clearSelection();
    selectedKeys = [];
  }

  /** Set one classification on the selected rows, or on everything when nothing is selected. */
  function setDocumentType(typeId: string | null): void {
    if (started) return;
    const keys =
      selectedKeys.length === 0
        ? entries.map(intakeEntryKey)
        : intakeKeysOfRows(entries, selectedKeys);
    const next = new Map(documentTypeIds);
    for (const key of keys) {
      if (typeId === null) next.delete(key);
      else next.set(key, typeId);
    }
    documentTypeIds = next;
  }

  /** Set the taken-name answer on the selected rows, or on everything when nothing is selected. */
  function setNameClash(choice: NameClashChoice): void {
    if (started) return;
    const keys =
      selectedKeys.length === 0
        ? entries.map(intakeEntryKey)
        : intakeKeysOfRows(entries, selectedKeys);
    const next = new Map(nameClashChoices);
    for (const key of keys) next.set(key, choice);
    nameClashChoices = next;
  }

  const entryByKey = $derived(new Map(entries.map((chosen) => [intakeEntryKey(chosen), chosen])));

  /*
   * Where a chosen file would land, as the destination stands now: the destination folder, then
   * each segment of the file's dropped path matched by name against the folders already there.
   * Undefined where a segment does not exist yet — a folder the upload will make holds nothing,
   * so nothing in it can be taken.
   */
  function landingFolderIdOf(chosen: DroppedEntry): string | null | undefined {
    const target = destinationIndex;
    if (target === null) return undefined;
    let folderId: string | null = destinationFolderId;
    const path = folderPathOf(chosen);
    if (path === "") return folderId;
    for (const segment of path.split("/")) {
      const next = target
        .childrenOf(folderId)
        .find((folder) => folder.name.localeCompare(segment, undefined, { sensitivity: "base" }) === 0);
      if (next === undefined) return undefined;
      folderId = next.id;
    }
    return folderId;
  }

  /**
   * The file already holding a chosen file's name where it lands, and what the reader chose about
   * it — the answer the Name Taken column shows and the batch acts on. Null where nothing clashes.
   */
  function nameClashFor(key: string): { takenBy: string; choice: NameClashChoice } | null {
    const chosen = entryByKey.get(key);
    if (chosen === undefined || destinationIndex === null) return null;
    const folderId = landingFolderIdOf(chosen);
    if (folderId === undefined) return null;
    const takenBy = collidingSibling(
      chosen.file.name,
      destinationIndex.filesIn(folderId).map((file) => ({ key: file.id, name: file.name })),
    );
    if (takenBy === null) return null;
    return { takenBy, choice: nameClashChoices.get(key) ?? nameClashDefault };
  }

  const hasNameClashes = $derived(
    entries.some((chosen) => nameClashFor(intakeEntryKey(chosen)) !== null),
  );

  /*
   * The two asks behind the one Add control. The File System Access pickers are preferred where the
   * engine has them: they raise no confirmation of their own, where a hidden `<input webkitdirectory>`
   * makes the browser ask a second time about a folder the reader has already chosen. The inputs
   * remain as the fallback for an engine without the API.
   */
  let filePicker = $state<HTMLInputElement | null>(null);
  let folderPicker = $state<HTMLInputElement | null>(null);

  function picked(event: Event & { currentTarget: HTMLInputElement }): void {
    const files = event.currentTarget.files;
    if (files !== null) add(entriesFromFileList(files));
    event.currentTarget.value = "";
  }

  function addFiles(): void {
    if (nativeFilePickerAvailable()) {
      void pickFiles().then(add);
      return;
    }
    filePicker?.click();
  }

  function addFolder(): void {
    if (nativeDirectoryPickerAvailable()) {
      void pickFolder().then(add);
      return;
    }
    folderPicker?.click();
  }

  // The whole source pane is the drop target. A counter rather than a flag: dragenter and
  // dragleave fire for every descendant the pointer crosses.
  let dragDepth = $state(0);
  const dragOver = $derived(dragDepth > 0 && !started);

  function dragEnter(event: DragEvent): void {
    if (started) return;
    event.preventDefault();
    dragDepth += 1;
  }
  function dragOverPane(event: DragEvent): void {
    if (started) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }
  function dragLeave(): void {
    dragDepth = Math.max(0, dragDepth - 1);
  }
  function drop(event: DragEvent): void {
    event.preventDefault();
    dragDepth = 0;
    if (started || event.dataTransfer === null) return;
    void entriesFromDataTransfer(event.dataTransfer).then(add);
  }

  // ---- the header line: what is chosen, then how it is going, in one place -----------------------

  const chosenLine = $derived(
    entries.length === 0
      ? "Nothing chosen yet"
      : `${intakePhrase(entries)} · ${formatBytes(intakeBytes(entries))}`,
  );
  const runningLine = $derived(batch === null ? "" : batchCountsText(batch));
  const paceLine = $derived(batch === null ? "" : batchPaceText(batch));

  // ---- opening, committing, leaving -------------------------------------------------------------

  function reset(): void {
    intakeTab = "location";
    destination = { id: matterId, title: matterTitle, label: matterTitle };
    folderChoice = "here";
    pickedFolderId = null;
    createdAtBasis = "source";
    documentTypeIds = new Map();
    nameClashDefault = "keep-both";
    nameClashChoices = new Map();
    entries = [...preselected];
    expanded = new Set(intakeFolderPaths(preselected));
    batch = null;
    sourceTable?.clearSelection();
    selectedKeys = [];
  }

  const refusal = $derived.by((): string | undefined => {
    if (started) return undefined;
    if (entries.length === 0) return "Choose files or a folder first.";
    if (otherLoading) return "That matter's folders are still being read.";
    return undefined;
  });

  async function upload(): Promise<ActionOutcome> {
    const target = destinationIndex ?? new MatterFileIndex([], []);
    batch = onStart({
      matterId: destination.id,
      matterTitle: destination.title,
      destinationFolderId,
      destinationLabel,
      entries,
      createdAtBasis,
      documentTypeIds,
      // Where each file stands right now, so the column carries on rather than starting over.
      readiness: intakeReadiness(entries),
      nameClashDefault,
      nameClashChoices,
      folders: target.folders,
      files: target.documents,
    });
    // "done", not "committed": the act has happened and the panel stays to show it running. The
    // bar ends at Close, and closing leaves the transfer to the queue.
    return Promise.resolve("done");
  }

  /*
   * Leaving the SCREEN with files chosen and not yet sent is the same loss as closing the panel,
   * and it is asked the same way. Navigation is cancelled, the question is put, and the reader's
   * "discard" carries the navigation out. A batch already running needs no question here: it is
   * the queue's now, and the tray shows it wherever the reader goes.
   */
  let leavingTo = $state<URL | null>(null);
  beforeNavigate((navigation) => {
    if (!open || started || entries.length === 0 || navigation.to === null) return;
    if (navigation.willUnload) return;
    navigation.cancel();
    leavingTo = navigation.to.url;
  });

  function discardAndLeave(): void {
    const target = leavingTo;
    leavingTo = null;
    open = false;
    dismissed();
    if (target !== null) void goto(target);
  }

  /**
   * Leaving the panel. A batch that has started keeps its reads — its items still want their
   * answers — but an intake abandoned before the press takes its reads with it, so a folder chosen
   * and thought better of does not go on being read in the background.
   */
  function dismissed(): void {
    if (batch === null) forgetDigests(entries.map(intakeEntryKey));
    onDismiss();
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Upload"
  commitLabel="Upload"
  commitBusyLabel="Uploading"
  commitRefusal={refusal}
  unsavedChanges={!started && entries.length > 0}
  onOpen={reset}
  onCommit={upload}
  onDismiss={dismissed}
>
  <!-- LEFT: the intake — what the files become, in two tabs. Every control stays put once Upload
       is pressed. -->
  {#snippet fields({ busy, done })}
    {@const locked = busy || done}
    <Tabs.Root bind:value={intakeTab} class="flex flex-col gap-16">
      <Tabs.List>
        <Tabs.Trigger value="location">Location</Tabs.Trigger>
        <Tabs.Trigger value="advanced">Advanced Settings</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="location" class="flex flex-col gap-16">
        <div class="flex flex-col gap-8">
          <Label for="{fieldPrefix}-matter">Matter</Label>
          <UploadMatterPicker
            bind:value={destination}
            inputId="{fieldPrefix}-matter"
            disabled={locked}
          />
        </div>
        <div class="flex flex-col gap-8">
          <Label id="{fieldPrefix}-folder-label">Folder</Label>
          <RadioGroup.Root
            bind:value={() => folderChoice, (next) => (folderChoice = next as FolderChoice)}
            disabled={locked || otherLoading}
            aria-labelledby="{fieldPrefix}-folder-label"
          >
            {#if hereName !== null}
              <div class="flex items-center gap-8">
                <RadioGroup.Item value="here" id="{fieldPrefix}-folder-here" />
                <Label for="{fieldPrefix}-folder-here">Current Folder: {hereName}</Label>
              </div>
            {/if}
            <div class="flex items-center gap-8">
              <RadioGroup.Item value="root" id="{fieldPrefix}-folder-root" />
              <Label for="{fieldPrefix}-folder-root">Home: {destination.title}</Label>
            </div>
            <div class="flex items-center gap-8">
              <RadioGroup.Item value="other" id="{fieldPrefix}-folder-other" />
              <Label for="{fieldPrefix}-folder-other">Choose a Folder</Label>
            </div>
          </RadioGroup.Root>
          {#if otherFailure !== null}
            <p class="text-xs text-status-danger-subtle-foreground">{otherFailure}</p>
          {/if}
          {#if folderChoice === "other" && destinationIndex !== null}
            <FolderPicker
              index={destinationIndex}
              bind:chosenFolderId={pickedFolderId}
              label="Upload Location"
              disabled={locked}
            />
          {/if}
        </div>
      </Tabs.Content>

      <!-- Everything here already has the answer nearly every upload wants. -->
      <Tabs.Content value="advanced" class="flex flex-col gap-16">
        <div class="flex flex-col gap-8">
          <Label id="{fieldPrefix}-dating-label">Date Created</Label>
          <RadioGroup.Root
            bind:value={
              () => createdAtBasis, (next) => (createdAtBasis = next as "source" | "upload")
            }
            disabled={locked}
            aria-labelledby="{fieldPrefix}-dating-label"
          >
            <div class="flex items-center gap-8">
              <RadioGroup.Item value="source" id="{fieldPrefix}-dating-source" />
              <Label for="{fieldPrefix}-dating-source">The File's Own Date</Label>
            </div>
            <div class="flex items-center gap-8">
              <RadioGroup.Item value="upload" id="{fieldPrefix}-dating-upload" />
              <Label for="{fieldPrefix}-dating-upload">The Upload Date</Label>
            </div>
          </RadioGroup.Root>
        </div>
      </Tabs.Content>
    </Tabs.Root>
  {/snippet}

  <!-- RIGHT: the source — the files as they sit on the reader's disk, then how each is doing. -->
  {#snippet context({ busy, done })}
    {@const locked = busy || done}
    <!-- The pane is a drop target for the pointer only; the controls inside it are what a keyboard
         reaches, and the two hidden pickers are reached through the Add menu. Its height is the
         panel's height: pinned here, so nothing that arrives in the table can grow the frame. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex min-h-0 grow flex-col gap-8 rounded-md border border-dashed border-transparent"
      class:border-accent-default={dragOver}
      class:bg-accent-subtle={dragOver}
      style="block-size: {PANE_BLOCK_SIZE}"
      ondragenter={dragEnter}
      ondragover={dragOverPane}
      ondragleave={dragLeave}
      ondrop={drop}
    >
      <!-- One row, one height, before and after the press: the chosen count becomes the tally. -->
      <div class="flex min-h-32 items-center gap-8">
        <FieldLabel as="p">Source</FieldLabel>
        <span class="min-w-0 truncate text-xs text-text-subtle" role="status">
          {started ? runningLine : chosenLine}
        </span>
        <span class="ms-auto flex items-center gap-8">
          <!-- The way back to the whole list, in the surface's own control row, exactly where every
               other table in the product carries it. It draws nothing while nothing is filtered. -->
          {#if sourceTable !== null}
            <DataTable.ClearFilters grid={sourceTable.grid} />
          {/if}
          {#if !started && liveDocumentTypes.length > 0}
            <!-- The classification, set on what is selected — or on everything, when nothing is.
                 The Document Type column shows the answer, so a batch can carry several. -->
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class={buttonClasses({ variant: "ghost", size: "sm" })}
                title={selectedKeys.length === 0
                  ? "Set the document type on every file chosen"
                  : "Set the document type on the selected files"}
              >
                <Tag class="size-16" aria-hidden="true" />
                Document Type
                <ChevronDown class="size-16" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
                <DropdownMenu.Item onSelect={() => setDocumentType(null)}>None</DropdownMenu.Item>
                {#each liveDocumentTypes as type (type.id)}
                  <DropdownMenu.Item onSelect={() => setDocumentType(type.id)}>
                    {type.name}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
          {#if !started && hasNameClashes}
            <!-- The taken-name answer, set on what is selected — or on everything, when nothing
                 is. The Name Taken column shows the answer beside the file that has the name. -->
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class={buttonClasses({ variant: "ghost", size: "sm" })}
                title={selectedKeys.length === 0
                  ? "Decide what happens to every file whose name is taken"
                  : "Decide what happens to the selected files whose names are taken"}
              >
                <Files class="size-16" aria-hidden="true" />
                Name Taken
                <ChevronDown class="size-16" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
                {#each NAME_CLASH_ORDER as choice (choice)}
                  <DropdownMenu.Item onSelect={() => setNameClash(choice)}>
                    {NAME_CLASH_LABEL[choice]}
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          {/if}
          {#if !started && selectedKeys.length > 0}
            <Button variant="ghost" size="sm" onclick={removeSelected}>
              <X class="size-16" aria-hidden="true" />
              Remove Selected
            </Button>
          {/if}
          {#if batch !== null && batch.running}
            {@const running = batch}
            <!-- Stopping is offered where the transfer is watched. What has landed stays; what is
                 being sent is given back; what had not started reads "Not sent". -->
            <Button variant="secondary" size="sm" onclick={() => cancelUploadBatch(running)}>
              <Ban class="size-16" aria-hidden="true" />
              Cancel Upload
            </Button>
          {/if}
          {#if batch !== null && !batch.running && (batch.failed > 0 || unsentCount(batch) > 0)}
            {@const finished = batch}
            <!-- The way to try again sits beside the failure it answers, not only in the tray. -->
            <Button variant="secondary" size="sm" onclick={() => retryFailedUploads(finished)}>
              <RotateCcw class="size-16" aria-hidden="true" />
              {finished.failed > 0 ? "Retry Failed" : "Send the Rest"}
            </Button>
          {/if}
          <!-- ONE control, a real button: the design system's secondary button wearing the
               design system's menu, the way every menu-bearing control on the product's screens
               is built. The menu names both choices outright. The drop, which takes any mix of
               the two, needs neither. -->
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={buttonClasses({ variant: "secondary", size: "sm" })}
              disabled={locked}
              title={locked ? "The upload has started." : "Add files or a folder, or drop any mix here"}
            >
              <Plus class="size-16" aria-hidden="true" />
              Add
              <ChevronDown class="size-16" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
              <DropdownMenu.Item onSelect={addFiles}>
                <Plus class="size-16" aria-hidden="true" />
                File
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={addFolder}>
                <Plus class="size-16" aria-hidden="true" />
                Folder
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </span>
      </div>

      <!-- Mounted from the start at zero, at the height of the pace line that joins it once bytes
           move, so neither the press nor the first byte adds a row above the table. Bytes, not
           files: one large file among many small ones would otherwise sit at "almost done" for
           most of the transfer. -->
      <div class="flex min-h-16 items-center gap-8">
        <Progress
          value={batch === null ? 0 : batch.sentBytes}
          max={batch === null ? 1 : Math.max(batch.totalBytes, 1)}
          aria-label="Upload progress"
          class="min-w-0 grow"
        />
        <!-- The pace line's room is RESERVED, filled or not. It reads "1.2 GB of 4.5 GB · 2.4 MB/s
             · about 20 min left" and every one of those figures changes length as the transfer
             runs — "9.9 MB" becomes "10.1 MB", "1 min" becomes "about 20 min" — so a line sized to
             its own text resized the bar beside it several times a second. A fixed measure holds
             the bar still; what will not fit is clipped rather than allowed to push. -->
        <span
          class="shrink-0 truncate text-end text-xs tabular-nums text-text-subtle"
          style="inline-size: var(--mc-size-transfer-pace)"
          role="status"
          title={paceLine}
        >
          {paceLine}
        </span>
      </div>

      <UploadSourceTable
        bind:this={sourceTable}
        {entries}
        {progress}
        bind:expanded
        caption="Files chosen for upload"
        emptyLine="Drop files or folders here, or use Add above. Nothing is sent until Upload is pressed."
        selectable={!started}
        {documentTypeName}
        hasDocumentTypes={liveDocumentTypes.length > 0}
        nameClash={nameClashFor}
        {hasNameClashes}
        onSelectionChange={(keys) => (selectedKeys = keys)}
      />

      <!-- The two native pickers, reached only through the Add menu. -->
      <input
        bind:this={filePicker}
        type="file"
        multiple
        class="sr-only"
        aria-hidden="true"
        tabindex="-1"
        onchange={picked}
      />
      <input
        bind:this={folderPicker}
        type="file"
        webkitdirectory
        multiple
        class="sr-only"
        aria-hidden="true"
        tabindex="-1"
        onchange={picked}
      />
    </div>
  {/snippet}
</ActionDialog>

<!-- The question a navigation away asks while files are chosen and not yet sent: the product's one
     panel for an act asked of a reader, in its question kind, so the verbs, the dismissal and the
     primitive are the shell's and not this surface's. -->
<ActionDialog
  bind:open={
    () => leavingTo !== null,
    (showing) => {
      if (!showing) leavingTo = null;
    }
  }
  kind="confirm"
  heading="Discard Your Changes?"
  commitLabel="Discard Changes"
  unsavedChanges={false}
  onCommit={() => {
    discardAndLeave();
    return Promise.resolve("committed");
  }}
/>
