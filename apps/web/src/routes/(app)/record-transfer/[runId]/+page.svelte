<script lang="ts">
  /*
   * A record transfer run's workspace: its files on the left, and the selected file's columns,
   * report and sample on the right.
   *
   * ONE READ FEEDS THE SCREEN. The run answers with its files and its passes, and everything the
   * header and the left panel say is counted from the latest pass of each file. What is read per
   * file is read when the file is selected: its first rows, its saved mapping, what its latest pass
   * was asked with, and that pass's report.
   *
   * A PASS RUNS AWAY FROM THE REQUEST. Asking for one answers at once, and the pass is then asked
   * about every few seconds until it ends. Each answer is written into the run's cached read, so
   * the badges, the summary and the tabs all move together.
   *
   * A MAPPING IS SAVED WHEN SAVE IS PRESSED, and not before. Asking for a pass is a commit too, so
   * it saves the mapping the pass runs with. A file opens on the mapping it was saved with. A file
   * that has been run opens on what its latest pass ran under, unless the mapping was saved after
   * that pass was asked for.
   *
   * A RUN ENDS ONE OF TWO WAYS, from the page's menu: accepted or stopped. After either, the page
   * reads the run and changes nothing in it.
   *
   * WHAT A FILE HOLDS is known from its latest pass. Before any pass it is the answer given when the
   * file was uploaded, which this page remembers for the session and which also rides on the file
   * as the slug it was registered under.
   */
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    matterTypesListOptions,
    membersListOptions,
    recordTransferGetRunOptions,
    recordTransferListRunsQueryKey,
    type RecordTransferRun,
    type RecordTransferRunResponse,
  } from "@magna-carta/api-client";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import ChoiceRow from "@magna-carta/design-system/choice-row";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleStop from "@lucide/svelte/icons/circle-stop";
  import { failureOf } from "$lib/api/api-client.ts";
  import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";
  import { readerTimeZone } from "$lib/calendar/calendar-api.ts";
  import { saveToTarget } from "$lib/export/save-target.ts";
  import { firmOffices } from "$lib/offices/firm-offices.svelte.ts";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ColumnsTab from "$lib/record-transfer/columns-tab.svelte";
  import EndRunDialog from "$lib/record-transfer/end-run-dialog.svelte";
  import ReportTab from "$lib/record-transfer/report-tab.svelte";
  import SampleTab from "$lib/record-transfer/sample-tab.svelte";
  import UploadFileDialog from "$lib/record-transfer/upload-file-dialog.svelte";
  import {
    blankMapping,
    columnHolding,
    delimiterHintedBy,
    fileKindChoiceFor,
    mappingFingerprint,
    mappingFromStated,
    mappingProblems,
    openingMapping,
    passRequestFrom,
    type FileMapping,
    type MappingDefaults,
    type MappingSaveState,
    type TransferRecordKind,
  } from "$lib/record-transfer/column-mapping.ts";
  import {
    downloadRejectedRows,
    listSourceFileColumnValues,
    previewSourceFile,
    readSourceFileMapping,
    readTransferPass,
    readTransferPassReport,
    readTransferPassRules,
    requestTransferPass,
    saveSourceFileMapping,
    type ColumnCodesRead,
    type TransferPassOutcome,
  } from "$lib/record-transfer/record-transfer-api.ts";
  import {
    arrivedCount,
    cutoverChecks,
    cutoverStandingLabel,
    formatCount,
    heldFiles,
    latestFinishedPassOf,
    latestPassOf,
    passIsInFlight,
    passStateLabel,
    recordKindLabel,
    recordKindOfFile,
    rejectedRowsFileName,
    reportCount,
    runIsOpen,
    runStatusLabel,
    runSummary,
    type CutoverStanding,
    type TransferPass,
    type TransferSourceFile,
  } from "$lib/record-transfer/transfer-run-view.ts";

  /** How often a pass that has not ended is asked about. */
  const PASS_POLL_MILLISECONDS = 3000;

  const runId = $derived(page.params.runId ?? "");
  const runOptions = $derived(recordTransferGetRunOptions({ path: { runId } }));
  const runRead = createQuery(() => runOptions);
  const membersRead = createQuery(() => ({ ...membersListOptions(), staleTime: SESSION_STABLE }));
  const matterTypesRead = createQuery(() => ({
    ...matterTypesListOptions(),
    staleTime: SESSION_STABLE,
  }));

  const run = $derived(runRead.data?.run ?? null);
  const files = $derived(heldFiles(runRead.data?.files ?? []));
  const passes = $derived<readonly TransferPass[]>(runRead.data?.passes ?? []);
  const open = $derived(run !== null && runIsOpen(run));

  /** What each file was said to hold when it was uploaded in this session. */
  let declared = $state<Record<string, TransferRecordKind>>({});
  let selectedFileId = $state<string | null>(null);
  let tab = $state("columns");
  let uploadOpen = $state(false);

  const selectedFile = $derived(
    files.find((file) => file.id === selectedFileId) ?? files[0] ?? null,
  );
  const selectedKind = $derived(
    selectedFile === null ? null : recordKindOfFile(selectedFile, passes, declared),
  );
  const latestPass = $derived(selectedFile === null ? null : latestPassOf(passes, selectedFile.id));
  const finishedPass = $derived(
    selectedFile === null ? null : latestFinishedPassOf(passes, selectedFile.id),
  );

  /*
   * What a client or party column can refer to: the rows of the run's people and organization
   * files, by the slug each was linked under. A kind with no file yet is still offered under its
   * usual slug, so a matter file can be mapped before the people file is uploaded.
   */
  const referenceOptions = $derived.by<readonly ChoiceOption[]>(() => {
    const labels = new Map<string, string[]>();
    for (const file of files) {
      if (file.id === selectedFile?.id) continue;
      const kind = recordKindOfFile(file, passes, declared);
      if (kind !== "person" && kind !== "organization") continue;
      const slug = latestPassOf(passes, file.id)?.sourceKind ?? fileKindChoiceFor(kind).sourceKind;
      labels.set(slug, [...(labels.get(slug) ?? []), file.fileName]);
    }
    for (const kind of ["person", "organization"] as const) {
      const choice = fileKindChoiceFor(kind);
      if (!labels.has(choice.sourceKind)) labels.set(choice.sourceKind, [choice.label]);
    }
    return [...labels].map(([value, names]) => ({ value, label: names.join(", ") }));
  });

  /** The firm's default office's zone, or its only office's where none is marked the default. */
  const firmTimeZone = $derived.by(() => {
    const offices = firmOffices.active;
    const office =
      offices.find((candidate) => candidate.firmDefault) ??
      (offices.length === 1 ? offices[0] : undefined);
    return office?.timeZone ?? null;
  });

  const defaults = $derived.by<MappingDefaults>(() => {
    const peopleFile = files.find(
      (file) => recordKindOfFile(file, passes, declared) === "person",
    );
    return {
      // The firm's own zone is its default office's. Where no office states one, the zone this
      // browser is in is the nearest thing the page knows.
      timeZone: firmTimeZone ?? (readerTimeZone() || "UTC"),
      referenceSourceKind:
        (peopleFile === undefined ? undefined : latestPassOf(passes, peopleFile.id)?.sourceKind) ??
        fileKindChoiceFor("person").sourceKind,
    };
  });

  const memberOptions = $derived<readonly ChoiceOption[]>(
    (membersRead.data?.data ?? [])
      .filter((member) => member.status === "active")
      .map((member) => ({ value: member.userId, label: member.displayName })),
  );
  const matterTypeOptions = $derived<readonly ChoiceOption[]>(
    (matterTypesRead.data?.data ?? [])
      .filter((type) => type.active)
      .map((type) => ({ value: type.id, label: type.name, aside: type.code ?? undefined })),
  );

  /* What the Columns tab holds, per file, for as long as the page is open. */
  interface FilePreview {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  }
  let mappings = $state<Record<string, FileMapping>>({});
  let previews = $state<Record<string, FilePreview>>({});
  let previewFailures = $state<Record<string, StatedFailure>>({});
  let attempted = $state<Record<string, boolean>>({});
  const preparing = new Set<string>();

  const mapping = $derived(selectedFile === null ? null : (mappings[selectedFile.id] ?? null));
  const preview = $derived(selectedFile === null ? null : (previews[selectedFile.id] ?? null));
  const problems = $derived(
    mapping === null || preview === null ? null : mappingProblems(mapping, preview.columns),
  );

  /**
   * Read a file's first rows, and settle the mapping its Columns tab opens on: the saved one, the
   * one its latest pass ran under, or a blank one for what the file holds.
   */
  async function prepareFile(
    file: TransferSourceFile,
    kind: TransferRecordKind | null,
    pass: TransferPass | null,
  ): Promise<void> {
    if (preparing.has(file.id)) return;
    preparing.add(file.id);
    const { [file.id]: _cleared, ...remaining } = previewFailures;
    previewFailures = remaining;

    // A blank mapping starts on the firm's time zone, so the offices are in hand before one is made.
    await firmOffices.load(fetch);
    let settled = mappings[file.id] ?? null;
    let source: "saved" | "stated" | "none" = "none";
    if (settled === null) {
      const [rules, saved] = await Promise.all([
        pass === null ? null : readTransferPassRules(runId, pass.id),
        readSourceFileMapping(runId, file.id),
      ]);
      // A saved mapping that can't be read is not the same as none. Opening blank over it would
      // save the blank one in its place, so the file waits for the read.
      if (saved.kind !== "ok") {
        previewFailures = {
          ...previewFailures,
          [file.id]: stated(saved.failure, "The saved columns of this file couldn't be read."),
        };
        preparing.delete(file.id);
        return;
      }
      const opening = openingMapping({
        saved: saved.value.saved,
        stated: rules?.kind === "ok" ? mappingFromStated(rules.value, defaults) : null,
        passRequestedAt: pass?.requestedAt ?? null,
      });
      settled = opening.mapping;
      source = opening.source;
      if (opening.mapping !== null && opening.source === "saved") {
        declared = { ...declared, [file.id]: opening.mapping.recordKind };
      }
    }
    if (settled === null && kind !== null) settled = blankMapping(kind, defaults);

    let delimiter = settled?.delimiter ?? "comma";
    let read = await previewSourceFile(runId, file.id, delimiter);
    if (read.kind === "ok" && source === "none" && pass === null) {
      // A header read as one column that still has another delimiter in it was read wrongly.
      const hinted = delimiterHintedBy(read.value.columns);
      if (hinted !== null && hinted !== delimiter) {
        const again = await previewSourceFile(runId, file.id, hinted);
        if (again.kind === "ok" && again.value.columns.length > 1) {
          read = again;
          delimiter = hinted;
        }
      }
    }
    if (read.kind === "ok") {
      previews = { ...previews, [file.id]: read.value };
      if (settled !== null && mappings[file.id] === undefined) {
        const opened = { ...settled, delimiter };
        mappings = { ...mappings, [file.id]: opened };
        // A saved mapping, or one a pass ran under, is already kept, so a change is measured
        // against it. A blank one is kept nowhere and stands as not saved.
        if (source !== "none") {
          lastKept = { ...lastKept, [file.id]: mappingFingerprint(opened) };
        }
        if (source === "saved") savedFiles = { ...savedFiles, [file.id]: true };
      }
    } else {
      previewFailures = {
        ...previewFailures,
        [file.id]: stated(read.failure, "The first rows of this file couldn't be read."),
      };
    }
    preparing.delete(file.id);
  }

  $effect(() => {
    const file = selectedFile;
    const kind = selectedKind;
    if (file === null) return;
    const ready = previews[file.id] !== undefined && (mappings[file.id] !== undefined || kind === null);
    if (ready || previewFailures[file.id] !== undefined) return;
    untrack(() => void prepareFile(file, kind, latestPass));
  });

  function chooseKind(recordKind: TransferRecordKind): void {
    if (selectedFile === null) return;
    declared = { ...declared, [selectedFile.id]: recordKind };
    changeMapping(selectedFile.id, blankMapping(recordKind, defaults));
  }

  /*
   * Saving a mapping. Each file has the fingerprint of the mapping that is kept for it: the one
   * last saved, or the one it opened on where that came from a save or a pass. A mapping that
   * differs from it has changes that are not saved.
   */
  let lastKept = $state<Record<string, string>>({});
  /** Files whose mapping stands as saved, which is what lets the Columns tab say so. */
  let savedFiles = $state<Record<string, boolean>>({});
  let savingFiles = $state<Record<string, boolean>>({});
  let saveFailures = $state<Record<string, StatedFailure>>({});

  function mappingIsUnsaved(fileId: string): boolean {
    const current = mappings[fileId];
    return current !== undefined && mappingFingerprint(current) !== lastKept[fileId];
  }

  async function saveMapping(fileId: string): Promise<void> {
    const current = mappings[fileId];
    if (current === undefined || !open || savingFiles[fileId] === true) return;
    if (!mappingIsUnsaved(fileId)) return;
    const sent = $state.snapshot(current) as FileMapping;
    const fingerprint = mappingFingerprint(sent);
    savingFiles = { ...savingFiles, [fileId]: true };
    const { [fileId]: _cleared, ...remaining } = saveFailures;
    saveFailures = remaining;
    const outcome = await saveSourceFileMapping(runId, fileId, sent);
    savingFiles = { ...savingFiles, [fileId]: false };
    if (outcome.kind !== "ok") {
      saveFailures = {
        ...saveFailures,
        [fileId]: stated(
          outcome.failure,
          "The columns couldn't be saved. Your changes are still on this page.",
        ),
      };
      return;
    }
    lastKept = { ...lastKept, [fileId]: fingerprint };
    savedFiles = { ...savedFiles, [fileId]: true };
  }

  function changeMapping(fileId: string, next: FileMapping): void {
    mappings = { ...mappings, [fileId]: next };
  }

  const saveState = $derived.by<MappingSaveState>(() => {
    if (selectedFile === null || mapping === null) return "idle";
    const fileId = selectedFile.id;
    if (savingFiles[fileId] === true) return "saving";
    // A run that has ended takes no save, so its mapping is read and nothing is said about it.
    if (mappingIsUnsaved(fileId)) return open ? "unsaved" : "idle";
    return savedFiles[fileId] === true ? "saved" : "idle";
  });

  /*
   * The codes of a matter type or staff column, read once per column and kept for the page's life.
   * A file never changes, so neither do its codes.
   */
  let columnCodes = $state<Record<string, ColumnCodesRead>>({});
  const READING_CODES: ColumnCodesRead = { kind: "reading" };

  function codesKey(fileId: string, current: FileMapping, column: string): string {
    return JSON.stringify([fileId, current.delimiter, column]);
  }

  async function readColumnCodes(fileId: string, current: FileMapping, column: string): Promise<void> {
    const key = codesKey(fileId, current, column);
    columnCodes = { ...columnCodes, [key]: READING_CODES };
    const read = await listSourceFileColumnValues(runId, fileId, column, current.delimiter);
    columnCodes = {
      ...columnCodes,
      [key]:
        read.kind === "ok"
          ? { kind: "read", codes: read.value.values, truncated: read.value.truncated }
          : {
              kind: "failed",
              failure: stated(read.failure, "The codes in this column couldn't be read."),
            },
    };
  }

  const matterTypeColumn = $derived(
    mapping === null || preview === null
      ? undefined
      : columnHolding(mapping, preview.columns, "matterType"),
  );
  const memberColumn = $derived(
    mapping === null || preview === null
      ? undefined
      : columnHolding(mapping, preview.columns, "responsibleMember"),
  );

  function codesOf(column: string | undefined): ColumnCodesRead {
    if (selectedFile === null || mapping === null || column === undefined) return READING_CODES;
    return columnCodes[codesKey(selectedFile.id, mapping, column)] ?? READING_CODES;
  }

  const matterTypeCodes = $derived(codesOf(matterTypeColumn));
  const memberCodes = $derived(codesOf(memberColumn));

  $effect(() => {
    const file = selectedFile;
    const current = mapping;
    if (file === null || current === null) return;
    for (const column of [matterTypeColumn, memberColumn]) {
      if (column === undefined) continue;
      if (columnCodes[codesKey(file.id, current, column)] !== undefined) continue;
      untrack(() => void readColumnCodes(file.id, current, column));
    }
  });

  /** Ask again for the codes of the selected file's columns whose read failed. */
  function retryColumnCodes(): void {
    if (selectedFile === null || mapping === null) return;
    const kept = { ...columnCodes };
    for (const column of [matterTypeColumn, memberColumn]) {
      if (column === undefined) continue;
      const key = codesKey(selectedFile.id, mapping, column);
      if (kept[key]?.kind === "failed") delete kept[key];
    }
    columnCodes = kept;
  }

  /* Saving the rows a finished pass rejected, as a file. */
  let downloading = $state<Record<string, boolean>>({});
  let downloadFailures = $state<Record<string, StatedFailure>>({});

  async function downloadRejected(): Promise<void> {
    if (selectedFile === null || finishedPass === null) return;
    const passId = finishedPass.id;
    if (downloading[passId] === true) return;
    const fileName = rejectedRowsFileName(selectedFile.fileName);
    downloading = { ...downloading, [passId]: true };
    const { [passId]: _cleared, ...remaining } = downloadFailures;
    downloadFailures = remaining;
    const outcome = await downloadRejectedRows(runId, passId);
    if (outcome.kind === "ok") {
      await saveToTarget(outcome.value, fileName, "text/csv");
    } else {
      downloadFailures = {
        ...downloadFailures,
        [passId]: stated(outcome.failure, "The rejected rows couldn't be downloaded. Try again."),
      };
    }
    downloading = { ...downloading, [passId]: false };
  }

  const rejectedDownload = $derived(
    finishedPass === null || (finishedPass.counts?.rejected ?? 0) === 0
      ? null
      : {
          busy: downloading[finishedPass.id] === true,
          failure: downloadFailures[finishedPass.id] ?? null,
        },
  );

  /* Ending the run. */
  let acceptOpen = $state(false);
  let stopOpen = $state(false);

  function ended(endedRun: RecordTransferRun): void {
    queryClient.setQueryData<RecordTransferRunResponse>(runOptions.queryKey, (current) =>
      current === undefined ? current : { ...current, run: endedRun },
    );
    void queryClient.invalidateQueries({ queryKey: recordTransferListRunsQueryKey() });
  }

  /* A pass's report, read once it has ended and kept for the page's life. */
  let reports = $state<Record<string, TransferPassOutcome>>({});
  let reportFailures = $state<Record<string, StatedFailure>>({});
  const readingReports = new Set<string>();

  async function readReport(passId: string): Promise<void> {
    if (readingReports.has(passId)) return;
    readingReports.add(passId);
    const { [passId]: _cleared, ...remaining } = reportFailures;
    reportFailures = remaining;
    const read = await readTransferPassReport(runId, passId);
    if (read.kind === "ok") {
      reports = { ...reports, [passId]: read.value };
    } else {
      reportFailures = {
        ...reportFailures,
        [passId]: stated(read.failure, "The report couldn't be read."),
      };
    }
    readingReports.delete(passId);
  }

  $effect(() => {
    const wanted = [finishedPass, latestPass?.state === "failed" ? latestPass : null];
    for (const pass of wanted) {
      if (pass === null || reports[pass.id] !== undefined) continue;
      if (reportFailures[pass.id] !== undefined) continue;
      untrack(() => void readReport(pass.id));
    }
  });

  const finishedOutcome = $derived(finishedPass === null ? null : (reports[finishedPass.id] ?? null));
  const failedOutcome = $derived(
    latestPass?.state === "failed" ? (reports[latestPass.id] ?? null) : null,
  );
  const reportFailure = $derived(
    finishedPass === null ? null : (reportFailures[finishedPass.id] ?? null),
  );

  /** Write one pass's newest answer into the run's cached read. */
  function notePass(pass: TransferPass): void {
    queryClient.setQueryData<RecordTransferRunResponse>(runOptions.queryKey, (current) =>
      current === undefined
        ? current
        : {
            ...current,
            passes: current.passes.some((known) => known.id === pass.id)
              ? current.passes.map((known) => (known.id === pass.id ? pass : known))
              : [...current.passes, pass],
          },
    );
  }

  const inFlight = $derived(passes.filter(passIsInFlight).map((pass) => pass.id));
  const anyInFlight = $derived(inFlight.length > 0);

  $effect(() => {
    if (!anyInFlight) return;
    const timer = setInterval(() => {
      for (const passId of untrack(() => inFlight)) {
        void readTransferPass(runId, passId).then((read) => {
          if (read.kind !== "ok") return;
          notePass(read.value.pass);
          // A pass that has ended also wrote the file's row count, which the run's read carries.
          if (!passIsInFlight(read.value.pass)) void runRead.refetch();
        });
      }
    }, PASS_POLL_MILLISECONDS);
    return () => clearInterval(timer);
  });

  let requesting = $state(false);
  let runFailure = $state<StatedFailure | null>(null);

  const selectedInFlight = $derived(latestPass !== null && passIsInFlight(latestPass));
  const runRefusal = $derived.by(() => {
    if (!open) return "This run has ended. Start a new run.";
    if (selectedFile === null) return "Upload a file first.";
    if (selectedInFlight) return "A pass over this file hasn't ended yet.";
    if (mapping === null || preview === null) return "Choose the contents of this file first.";
    return undefined;
  });

  async function runPass(): Promise<void> {
    if (selectedFile === null || mapping === null || preview === null || requesting) return;
    const file = selectedFile;
    runFailure = null;
    const request = passRequestFrom(mapping, file.id, preview.columns);
    if (request === null) {
      // Refused here: what is unset turns red on the Columns tab, which is where it is fixed.
      attempted = { ...attempted, [file.id]: true };
      tab = "columns";
      return;
    }
    requesting = true;
    // Asking for a pass commits the mapping it runs with. The pass goes ahead whether or not the
    // save does, and a save that fails says so above the tabs.
    void saveMapping(file.id);
    const outcome = await requestTransferPass(runId, request, crypto.randomUUID());
    requesting = false;
    if (outcome.kind !== "ok") {
      runFailure = stated(outcome.failure, "The pass couldn't be started.");
      return;
    }
    attempted = { ...attempted, [file.id]: false };
    notePass(outcome.value.pass);
  }

  function uploaded(file: TransferSourceFile, recordKind: TransferRecordKind): void {
    declared = { ...declared, [file.id]: recordKind };
    queryClient.setQueryData<RecordTransferRunResponse>(runOptions.queryKey, (current) =>
      current === undefined ? current : { ...current, files: [...current.files, file] },
    );
    selectedFileId = file.id;
    tab = "columns";
  }

  function selectFile(fileId: string): void {
    selectedFileId = fileId;
    runFailure = null;
  }

  function standingVariant(standing: CutoverStanding): "success" | "warning" | "neutral" {
    if (standing.kind === "done") return "success";
    if (standing.kind === "open") return "warning";
    return "neutral";
  }

  const summary = $derived(runRead.data === undefined ? "" : runSummary(files, passes, open));
  const saveFailure = $derived(
    selectedFile === null ? null : (saveFailures[selectedFile.id] ?? null),
  );
  const checks = $derived(cutoverChecks(files, passes, declared));
  const reportTotal = $derived(
    finishedPass?.counts === null || finishedPass?.counts === undefined
      ? null
      : reportCount(finishedPass.counts),
  );
</script>

<svelte:head><title>{run?.label ?? "Record Transfer"} · Magna Carta</title></svelte:head>

<!-- The run's two acts. They sit in the header's action row, and on a phone in a row of their own
     under the header, where the title would otherwise be squeezed to a few letters a line. -->
{#snippet runActions()}
  <Button
    variant="secondary"
    disabled={!open}
    title={open ? undefined : "This run has ended. Start a new run."}
    onclick={() => (uploadOpen = true)}
  >
    Upload a File
  </Button>
  <Button
    variant="primary"
    disabled={runRefusal !== undefined || requesting}
    title={runRefusal}
    onclick={() => void runPass()}
  >
    {latestPass === null ? "Run" : "Run Again"}
  </Button>
{/snippet}

<div class="flex flex-col gap-24">
  <ScreenHeader title={run?.label ?? "Record Transfer"} back="record-transfer">
    {#snippet meta()}
      {#if run !== null && !open}
        <Badge variant={run.completedAt === null ? "neutral" : "success"}>
          {runStatusLabel(run)}
        </Badge>
      {/if}
      {summary}
    {/snippet}
    {#snippet actions()}
      <div class="hidden items-center gap-8 sm:flex">
        {@render runActions()}
      </div>
    {/snippet}
    {#snippet pageMenu()}
      <!-- The two ways a run ends. Each is asked once in a run's life and is about the run as a
           whole, so they stand in the page's menu and the row keeps the work on a file. Disabled
           and still shown once the run has ended, so the menu keeps one shape. -->
      <DropdownMenu.Item disabled={!open} onSelect={() => (acceptOpen = true)}>
        <CircleCheck class="size-16 shrink-0" aria-hidden="true" />
        Accept Run
      </DropdownMenu.Item>
      <DropdownMenu.Item disabled={!open} onSelect={() => (stopOpen = true)}>
        <CircleStop class="size-16 shrink-0" aria-hidden="true" />
        Stop Run
      </DropdownMenu.Item>
    {/snippet}
  </ScreenHeader>
  <div class="flex flex-wrap items-center gap-8 sm:hidden">
    {@render runActions()}
  </div>

  {#if runRead.isError}
    <FailureNotice
      failure={failureOf(runRead.error)}
      subject="This run"
      fallback="This run couldn't be read."
      onRetry={() => void runRead.refetch()}
    />
  {:else}
    <div class="flex flex-col gap-24 xl:flex-row xl:items-start">
      <Card.Root class="xl:w-xs xl:shrink-0">
        <Card.Content class="flex flex-col gap-24">
          <section class="flex flex-col gap-8">
            <FieldLabel as="h2">Files in This Run</FieldLabel>
            <LoadingRegion
              loading={runRead.isPending}
              label="Reading the run's files"
              class="flex flex-col gap-8"
            >
              {#snippet fixture()}
                <ChoiceRow disabled>
                  Sample file
                  {#snippet detail()}
                    <span class="flex flex-col gap-4">
                      <span>People</span>
                      <span><Badge variant="neutral">Not run</Badge></span>
                    </span>
                  {/snippet}
                </ChoiceRow>
              {/snippet}
              {#each files as file (file.id)}
                {@const pass = latestPassOf(passes, file.id)}
                {@const counts = latestFinishedPassOf(passes, file.id)?.counts ?? null}
                <ChoiceRow
                  selected={file.id === selectedFile?.id}
                  onclick={() => selectFile(file.id)}
                >
                  <span class="break-all">{file.fileName}</span>
                  {#snippet detail()}
                    <span class="flex flex-col gap-4">
                      <span>{recordKindLabel(recordKindOfFile(file, passes, declared))}</span>
                      <span class="flex flex-wrap gap-4">
                        {#if counts !== null}
                          <Badge variant="success">{formatCount(arrivedCount(counts))} arrived</Badge>
                          {#if counts.waiting > 0}
                            <Badge variant="warning" title="Waiting rows">
                              {formatCount(counts.waiting)}
                              <span class="sr-only">waiting</span>
                            </Badge>
                          {/if}
                          {#if counts.rejected > 0}
                            <Badge variant="danger" title="Rejected rows">
                              {formatCount(counts.rejected)}
                              <span class="sr-only">rejected</span>
                            </Badge>
                          {/if}
                        {/if}
                        {#if pass === null}
                          <Badge variant="neutral">Not run</Badge>
                        {:else if pass.state === "requested" || pass.state === "running"}
                          <Badge variant="info">{passStateLabel(pass.state)}</Badge>
                        {:else if pass.state === "stalled"}
                          <Badge variant="warning">{passStateLabel(pass.state)}</Badge>
                        {:else if pass.state === "failed"}
                          <Badge variant="danger">{passStateLabel(pass.state)}</Badge>
                        {/if}
                      </span>
                    </span>
                  {/snippet}
                </ChoiceRow>
              {:else}
                <p class="text-sm text-text-muted">No files yet.</p>
              {/each}
            </LoadingRegion>
          </section>

          <section class="flex flex-col gap-8">
            <FieldLabel as="h2">Before Cutover</FieldLabel>
            <ul class="flex flex-col gap-8">
              {#each checks as check (check.id)}
                <li class="flex items-start gap-8 text-sm">
                  <Badge variant={standingVariant(check.standing)} class="shrink-0">
                    {cutoverStandingLabel(check.standing)}
                  </Badge>
                  <span class="min-w-0">{check.label}</span>
                </li>
              {/each}
            </ul>
          </section>
        </Card.Content>
      </Card.Root>

      <div class="flex min-w-0 flex-1 flex-col gap-16">
        {#if runFailure !== null}
          <FailureNotice
            failure={runFailure.failure}
            title="The Pass Was Not Started"
            fallback={runFailure.fallback}
            whenSilent={runFailure.whenSilent}
            onRetry={() => void runPass()}
          />
        {/if}
        {#if saveFailure !== null && selectedFile !== null}
          {@const fileId = selectedFile.id}
          <FailureNotice
            failure={saveFailure.failure}
            title="The Columns Were Not Saved"
            fallback={saveFailure.fallback}
            whenSilent={saveFailure.whenSilent}
            onRetry={() => void saveMapping(fileId)}
          />
        {/if}
        <Tabs.Root bind:value={tab}>
          <Tabs.List>
            <Tabs.Trigger value="columns">Columns</Tabs.Trigger>
            <Tabs.Trigger value="report">
              {reportTotal === null ? "Report" : `Report (${formatCount(reportTotal)})`}
            </Tabs.Trigger>
            <Tabs.Trigger value="sample">Sample</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="columns" class="pt-16">
            <ColumnsTab
              fileName={selectedFile?.fileName ?? ""}
              noFile={selectedFile === null && !runRead.isPending}
              {preview}
              previewFailure={selectedFile === null
                ? null
                : (previewFailures[selectedFile.id] ?? null)}
              onRetryPreview={() => {
                if (selectedFile === null) return;
                const { [selectedFile.id]: _cleared, ...remaining } = previewFailures;
                previewFailures = remaining;
              }}
              {mapping}
              {defaults}
              {problems}
              attempted={selectedFile !== null && attempted[selectedFile.id] === true}
              {referenceOptions}
              {matterTypeOptions}
              {memberOptions}
              {matterTypeCodes}
              {memberCodes}
              onRetryCodes={retryColumnCodes}
              {saveState}
              onSave={() => {
                if (selectedFile !== null) void saveMapping(selectedFile.id);
              }}
              disabled={!open}
              onChange={(next) => {
                if (selectedFile === null) return;
                changeMapping(selectedFile.id, next);
              }}
              onChooseKind={chooseKind}
            />
          </Tabs.Content>

          <Tabs.Content value="report" class="pt-16">
            <ReportTab
              fileName={selectedFile?.fileName ?? ""}
              {latestPass}
              reading={finishedPass !== null && finishedOutcome === null && reportFailure === null}
              outcome={finishedOutcome}
              {failedOutcome}
              readFailure={reportFailure}
              onRetry={() => {
                if (finishedPass === null) return;
                const { [finishedPass.id]: _cleared, ...remaining } = reportFailures;
                reportFailures = remaining;
              }}
              {rejectedDownload}
              onDownloadRejected={() => void downloadRejected()}
            />
          </Tabs.Content>

          <Tabs.Content value="sample" class="pt-16">
            <SampleTab
              fileName={selectedFile?.fileName ?? ""}
              recordKind={finishedPass?.recordKind ?? null}
              outcome={finishedOutcome}
              reading={finishedPass !== null && finishedOutcome === null && reportFailure === null}
              readFailure={reportFailure}
              onRetry={() => {
                if (finishedPass === null) return;
                const { [finishedPass.id]: _cleared, ...remaining } = reportFailures;
                reportFailures = remaining;
              }}
            />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  {/if}
</div>

<UploadFileDialog
  bind:open={uploadOpen}
  {runId}
  runLabel={run?.label ?? ""}
  onUploaded={uploaded}
/>

<EndRunDialog
  bind:acceptOpen
  bind:stopOpen
  {runId}
  runLabel={run?.label ?? ""}
  passInFlight={anyInFlight}
  onEnded={ended}
/>
