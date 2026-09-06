<script lang="ts">
  /*
   * The Upload dialog — intake on the left, source on the right, and the one press that sends.
   *
   * TWO SIDES, TWO JOBS. The LEFT is the INTAKE: what the arriving files become — which matter and
   * folder they land in, how they are dated, what document type they carry. It is read top to
   * bottom once and then left alone. The RIGHT is the SOURCE: the files and folders themselves, as
   * the product's one table, nested the way they sit on the reader's disk, filterable from its
   * header, each row saying where it stands once the transfer runs. They belong apart because they
   * move at different speeds — the intake is decided once, the source changes every second while
   * bytes move — and the owner's ruling (2026-09-06) put the intake on the left and the source on
   * the right.
   *
   * NOTHING IS SENT UNTIL UPLOAD IS PRESSED. Choose (dropped anywhere on the source pane, or
   * through the one Add control, which offers files or a folder), decide where they go, press
   * Upload. Cancelling before that sends nothing, so there is nothing to un-save — and because
   * choosing is work, leaving with files chosen asks first, whether the reader leaves by the
   * panel's own exits or by navigating away from the screen beneath it.
   *
   * NOTHING MOVES WHEN UPLOAD IS PRESSED. The earlier panel swapped its left side from the chooser
   * to nothing and its right side from one list to another the moment the transfer began, and the
   * whole frame re-flowed under the reader's pointer. Here every control stays where it is and is
   * disabled; the source table stays the same table, and only its Status column changes. The
   * header row above the table carries the chosen count before the press and the running tally
   * after it, in the same place at the same height.
   *
   * THE TRANSFER OUTLIVES THE PANEL. Upload hands the batch to the upload queue and the panel stays
   * open to show it running — but it is a report, not a leash: Close leaves the bytes moving, the
   * top-bar upload tray keeps showing them, and the file list re-reads when they land.
   */
  import { beforeNavigate, goto } from "$app/navigation";
  import ActionDialog, { DISCARD_SENTENCE } from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import type { GridColumn } from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import FolderGlyph from "@magna-carta/design-system/folder-glyph";
  import Label from "@magna-carta/design-system/label";
  import Progress from "@magna-carta/design-system/progress";
  import {
    entriesFromDataTransfer,
    entriesFromFileList,
    type DroppedEntry,
  } from "@magna-carta/design-system/dropzone";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import FilePlus2 from "@lucide/svelte/icons/file-plus-2";
  import FolderUp from "@lucide/svelte/icons/folder-up";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Plus from "@lucide/svelte/icons/plus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import X from "@lucide/svelte/icons/x";
  import { formatBytes, MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";
  import { listMatterFolders } from "./folder-api.ts";
  import { listMatterFiles, type DocumentTypeSummary } from "./matter-file-api.ts";
  import {
    addIntakeEntries,
    intakeBytes,
    intakeColumns,
    intakeFolderPaths,
    intakePhrase,
    intakeRows,
    intakeStageSentence,
    orderIntakeRows,
    removeIntakeRows,
    type IntakeProgress,
    type IntakeRow,
  } from "./upload-intake.ts";
  import {
    retryFailedUploads,
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

  // ---- the intake ---------------------------------------------------------------------------------

  type FolderChoice = "here" | "root" | "other";
  type Destination = { id: string; title: string; label: string };

  let destination = $state<Destination>({ id: "", title: "", label: "" });
  let folderChoice = $state<FolderChoice>("here");
  let pickedFolderId = $state<string | null>(null);
  let createdAtBasis = $state<"source" | "upload">("source");
  let documentTypeId = $state<string | null>(null);

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
  const progress = $derived.by(
    (): ReadonlyMap<string, IntakeProgress> => batch?.progress ?? new Map(),
  );

  function add(incoming: readonly DroppedEntry[]): void {
    if (started || incoming.length === 0) return;
    entries = addIntakeEntries(entries, incoming);
    expanded = new Set([...expanded, ...intakeFolderPaths(incoming)]);
  }

  function toggleFolder(path: string): void {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expanded = next;
  }

  // The grid's own filter state decides the shape of its rows and columns, so both thunks read it
  // back off the grid — through a reference filled in right after construction, because the state
  // calls `columns()` once while it is being built, before the constant below exists.
  let built: DataTable.DataTableGridState<IntakeRow> | null = null;
  const filtering = (): boolean => built?.isFiltered ?? false;
  const grid = DataTable.createDataTableGrid<IntakeRow>({
    columns: (): GridColumn<IntakeRow>[] => intakeColumns({ filtering: filtering() }),
    // A filter flattens the tree to the files that answer it (upload-intake.ts says why).
    rows: () => intakeRows(entries, progress, filtering() ? null : expanded),
    rowKey: (row) => row.key,
    itemNoun: { singular: "item", plural: "items" },
    orderRows: orderIntakeRows,
    onActivate: (row) => {
      if (row.kind === "folder") toggleFolder(row.path);
    },
  });
  built = grid;

  function removeSelected(): void {
    if (started) return;
    entries = removeIntakeRows(entries, grid.selectedKeys);
    grid.clearSelection();
  }

  // The two native pickers behind the one Add control. A browser cannot ask for files AND a folder
  // in one picker, so the control is a menu of the two asks rather than two buttons.
  let filePicker = $state<HTMLInputElement | null>(null);
  let folderPicker = $state<HTMLInputElement | null>(null);

  function picked(event: Event & { currentTarget: HTMLInputElement }): void {
    const files = event.currentTarget.files;
    if (files !== null) add(entriesFromFileList(files));
    event.currentTarget.value = "";
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
  const runningLine = $derived.by(() => {
    if (batch === null) return "";
    const parts = [`${String(batch.uploaded)} of ${String(batch.total)} uploaded`];
    if (batch.failed > 0) parts.push(`${String(batch.failed)} failed`);
    return parts.join(" · ");
  });

  // ---- opening, committing, leaving -------------------------------------------------------------

  function reset(): void {
    destination = { id: matterId, title: matterTitle, label: matterTitle };
    folderChoice = "here";
    pickedFolderId = null;
    createdAtBasis = "source";
    documentTypeId = null;
    entries = [...preselected];
    expanded = new Set(intakeFolderPaths(preselected));
    batch = null;
    grid.clearSelection();
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
      documentTypeId,
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
    onDismiss();
    if (target !== null) void goto(target);
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
  {onDismiss}
>
  <!-- LEFT: the intake — what the files become. Every control stays put once Upload is pressed. -->
  {#snippet fields({ busy, done })}
    {@const locked = busy || done}
    <div class="flex flex-col gap-8">
      <FieldLabel as="p">Destination</FieldLabel>
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
    </div>

    <div class="flex flex-col gap-8">
      <FieldLabel as="p">On Arrival</FieldLabel>
      <div class="flex flex-col gap-8">
        <Label id="{fieldPrefix}-dating-label">Date Created</Label>
        <RadioGroup.Root
          bind:value={() => createdAtBasis, (next) => (createdAtBasis = next as "source" | "upload")}
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
      <div class="flex flex-col gap-8">
        <Label id="{fieldPrefix}-type-label">Document Type</Label>
        <Select.Root
          type="single"
          items={[
            { value: "", label: "None" },
            ...documentTypes
              .filter((type) => type.deactivatedAt === null)
              .map((type) => ({ value: type.id, label: type.name })),
          ]}
          allowDeselect={false}
          disabled={locked}
          bind:value={() => documentTypeId ?? "", (next) => (documentTypeId = next === "" ? null : next)}
        >
          <Select.Trigger aria-labelledby="{fieldPrefix}-type-label">
            <Select.Value placeholder="None" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="" label="None" />
            {#each documentTypes.filter((type) => type.deactivatedAt === null) as type (type.id)}
              <Select.Item value={type.id} label={type.name} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  {/snippet}

  <!-- RIGHT: the source — the files as they sit on the reader's disk, then how each is doing. -->
  {#snippet context({ busy, done })}
    {@const locked = busy || done}
    <!-- The pane is a drop target for the pointer only; the controls inside it are what a keyboard
         reaches, and the two hidden pickers are reached through the Add menu. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex min-h-0 grow flex-col gap-8 rounded-md border border-dashed border-transparent"
      class:border-accent-default={dragOver}
      class:bg-accent-subtle={dragOver}
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
          {#if !started && grid.selectedKeys.length > 0}
            <Button variant="ghost" size="sm" onclick={removeSelected}>
              <X class="size-16" aria-hidden="true" />
              Remove Selected
            </Button>
          {/if}
          {#if batch !== null && !batch.running && batch.failed > 0}
            {@const finished = batch}
            <!-- The way to try again sits beside the failure it answers, not only in the tray. -->
            <Button variant="secondary" size="sm" onclick={() => retryFailedUploads(finished)}>
              <RotateCcw class="size-16" aria-hidden="true" />
              Retry Failed
            </Button>
          {/if}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={buttonClasses({ variant: "secondary", size: "sm" })}
              disabled={locked}
              title={locked ? "The upload has started." : "Add files or a folder"}
            >
              <Plus class="size-16" aria-hidden="true" />
              Add
              <ChevronDown class="size-16" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
              <DropdownMenu.Item onSelect={() => filePicker?.click()}>
                <FilePlus2 class="size-16" aria-hidden="true" />
                Files
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => folderPicker?.click()}>
                <FolderUp class="size-16" aria-hidden="true" />
                A Folder, With Everything Inside It
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </span>
      </div>

      <!-- Mounted from the start at zero, so the press adds no row above the table. -->
      <Progress
        value={batch === null ? 0 : batch.uploaded + batch.failed}
        max={batch === null ? 1 : Math.max(batch.total, 1)}
        aria-label="Upload progress"
      />

      <div class="flex min-h-0 grow flex-col">
        <DataTable.Grid
          {grid}
          {cell}
          caption="Files chosen for upload"
          empty={emptyIntake}
          density="compact"
          class="min-h-0 grow rounded-b-none"
        />
        <DataTable.GridFooter
          {grid}
          tallyText={intakePhrase(entries)}
          selectAllToggle
          class="rounded-b-md border border-t-0 border-border-default"
        />
      </div>

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

{#snippet emptyIntake()}
  <EmptyState title="Nothing chosen yet">
    Drop files or folders here, or use Add above. Nothing is sent until Upload is pressed.
  </EmptyState>
{/snippet}

{#snippet cell({ row, column, text }: DataTable.GridCellContext<IntakeRow>)}
  {#if column.id === "name"}
    <!-- The indent is one tree step per level, the same measure the folder rail steps by. -->
    <span
      class="flex min-w-0 items-center gap-4"
      style="padding-inline-start: calc(var(--mc-space-16) * {row.depth})"
    >
      {#if row.kind === "folder"}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={row.expanded}
          aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
          onclick={(event: MouseEvent) => {
            event.stopPropagation();
            toggleFolder(row.path);
          }}
        >
          {#if row.expanded}
            <ChevronDown class="size-16" aria-hidden="true" />
          {:else}
            <ChevronRight class="size-16" aria-hidden="true" />
          {/if}
        </Button>
        <FolderGlyph class="size-16 shrink-0" />
      {:else}
        <!-- A file has no twisty; the same width keeps its glyph in the folder glyph's column. -->
        <span class="inline-block size-24 shrink-0" aria-hidden="true"></span>
        <FileIcon
          contentType={row.entry.file.type === "" ? undefined : row.entry.file.type}
          fileName={row.name}
          class="size-16 shrink-0"
        />
      {/if}
      <span class="truncate" title={row.kind === "file" ? row.entry.relativePath || row.name : row.path}>
        {text}
      </span>
    </span>
  {:else if column.id === "status" && row.kind === "file"}
    <span class="flex items-center gap-8" title={intakeStageSentence(row)}>
      {#if row.stage === "settled"}
        <CircleCheck
          class="size-16 shrink-0 text-status-success-subtle-foreground"
          aria-hidden="true"
        />
      {:else if row.stage === "failed"}
        <CircleAlert
          class="size-16 shrink-0 text-status-danger-subtle-foreground"
          aria-hidden="true"
        />
      {:else if row.stage !== "chosen"}
        <LoaderCircle class="size-16 shrink-0 text-text-subtle" aria-hidden="true" />
      {/if}
      <span class={row.stage === "chosen" ? "text-text-subtle" : undefined}>{text}</span>
    </span>
  {:else}
    {text}
  {/if}
{/snippet}

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
>
  {#snippet fields()}
    <p class="text-sm">{DISCARD_SENTENCE}</p>
  {/snippet}
</ActionDialog>
