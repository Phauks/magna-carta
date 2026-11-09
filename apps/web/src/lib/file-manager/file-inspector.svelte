<script lang="ts">
  /*
   * The details panel. It is TABBED — Preview, Details, Version History, Hashes, Safety — because
   * these are five different questions and stacking them made the one you came for the one you had
   * to scroll past. Preview is its own tab for the same reason: the thing you opened the file to
   * look at should not be a strip above the facts.
   *
   * The panel opens by its OWN control. Selecting a row never opens a closed panel; while it is
   * open, selection updates what it presents. That choice persists, so closing it stays closed.
   *
   * NO HORIZONTAL SCROLLBAR. If anything scrolls sideways here it is the tab strip, which is tall
   * enough to carry its own and therefore never grows a vertical one.
   *
   * HASHES RECOMPUTE. Every algorithm row is on screen before a value arrives, pending, filling in
   * as each digest lands — the reader sees what is coming rather than an empty box that fills
   * without warning. Agreement with what intake recorded is SILENT; a difference is stated loudly,
   * because on a matter record that difference is a chain-of-custody event.
   */
  import * as Tabs from "@magna-carta/design-system/tabs";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Label from "@magna-carta/design-system/label";
  import Input from "@magna-carta/design-system/input";
  import Textarea from "@magna-carta/design-system/textarea";
  import FileInput from "@magna-carta/design-system/file-input";
  import { sampleInstant, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import Separator from "@magna-carta/design-system/separator";
  import { formatInstant, placeholderOf } from "@magna-carta/design-system/formatters";
  import { statusEntry } from "@magna-carta/design-system/status-register";
  import SafetyMark from "./safety-mark.svelte";
  import DocumentTypeMenu from "./document-type-menu.svelte";
  import VersionChangesDialog from "./version-changes-dialog.svelte";
  import Flag from "@lucide/svelte/icons/flag";
  import Eye from "@lucide/svelte/icons/eye";
  import Hash from "@lucide/svelte/icons/hash";
  import GitCompare from "@lucide/svelte/icons/git-compare";
  import Diff from "@lucide/svelte/icons/diff";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import X from "@lucide/svelte/icons/x";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import type { FileManagerRow, FolderAggregate } from "./file-rows.ts";
  import { folderSizeText, formatBytes } from "./file-rows.ts";
  import { fileExtension, safetyKeyOf } from "./file-columns.ts";
  import {
    changesSummaryText,
    createdByText,
    foldedCount,
    foldedLabel,
    saveKindText,
    versionsToShow,
  } from "./version-history.ts";
  import {
    committedRename,
    displayName,
    renameFieldValue,
    renameSelectionEnd,
    splitName,
  } from "./file-names.ts";
  import { countPhrase } from "./file-manager-vocabulary.ts";
  import { waitingReason } from "./file-manager-availability.ts";
  import { sha256OfFile } from "./upload-hash.ts";
  import { expectedDigestText, readExpectedDigest } from "./hash-compare.ts";
  import {
    requestIsOpen,
    SCAN_EVENT_LABELS,
    scanEventDetailReading,
    scanEventEngineText,
    scanEventStatusKey,
    scanEventVerdictText,
    scanRequestWasNotQueued,
  } from "./scan-history-model.ts";
  import {
    SCAN_SETTINGS_FIXTURE,
    SCAN_SETTINGS_PROVENANCE,
    SCAN_SETTINGS_PROVENANCE_LABEL,
    scanSettingsLines,
  } from "./scan-policy-words.ts";
  import {
    decomposeScanEngineVersion,
    SCAN_ENGINE_FIXTURE_PARTS,
    SCAN_ENGINE_UNREPORTED_DETAIL,
    scanEngineReadingLines,
  } from "$lib/versions/scan-engine-version.ts";
  import {
    HASH_ALGORITHMS,
    type DocumentTypeSummary,
    type FileScanEvent,
    type FileScanHistory,
    type HashAlgorithm,
    type IntegrityVerification,
    type MatterFile,
    type MatterFileVersion,
  } from "./matter-file-api.ts";
  import { INSPECTOR_TABS, type InspectorTab } from "./file-manager-state.svelte.ts";

  let {
    row,
    hideExtensions,
    documentTypeName,
    documentTypes,
    versions,
    versionsLoading,
    versionsFailure,
    onRetryVersions,
    integrity,
    integrityVersionId,
    integrityRunning,
    scans,
    scansLoading,
    scansFailure,
    onRetryScans,
    rescanRunning,
    onRescan,
    folderAggregateOf,
    tab = $bindable("details"),
    onClose,
    onRenameCommit,
    onPickDocumentType,
    onAddDocumentType,
    onVerifyIntegrity,
    onOpenVersion,
    onRestoreVersion,
  }: {
    row: FileManagerRow | null;
    hideExtensions: boolean;
    documentTypeName: (documentTypeId: string | null) => string;
    documentTypes: readonly DocumentTypeSummary[];
    versions: readonly MatterFileVersion[] | null;
    versionsLoading: boolean;
    /** The failure that ended the versions read, so the panel can say so rather than "none yet". */
    versionsFailure: Failure | null;
    /** Ask for the versions again — the notice's Retry and the region's stalled line both use it. */
    onRetryVersions: () => void;
    integrity: IntegrityVerification | null;
    /** Which version `integrity` describes: a version id, or null for the current version. */
    integrityVersionId: string | null;
    integrityRunning: boolean;
    /** The file's safety history, or null before it is read. */
    scans: FileScanHistory | null;
    scansLoading: boolean;
    scansFailure: Failure | null;
    onRetryScans: () => void;
    /** A re-scan request is on its way to the server. */
    rescanRunning: boolean;
    /** Ask for a fresh check of one version — null for the current version. */
    onRescan: (versionId: string | null) => void;
    folderAggregateOf: (folderId: string) => FolderAggregate;
    tab?: InspectorTab;
    onClose: () => void;
    /**
     * Write a new name for what the panel is showing. Answers null when the record took it, or
     * the sentence saying why it did not — the panel keeps the field open holding what was typed,
     * states the sentence beneath it, and the record still holds the name it had.
     */
    onRenameCommit: (name: string) => Promise<string | null>;
    onPickDocumentType: (documentTypeId: string | null) => void;
    onAddDocumentType: (name: string) => void;
    /** Compute the digests of one version — null for the current version. */
    onVerifyIntegrity: (versionId: string | null) => void;
    onOpenVersion: (version: MatterFileVersion) => void;
    onRestoreVersion: (version: MatterFileVersion) => void;
  } = $props();

  const file = $derived(row?.kind === "file" ? row.file : null);
  const folder = $derived(row?.kind === "folder" ? row.folder : null);

  const TAB_LABELS: Readonly<Record<InspectorTab, string>> = {
    preview: "Preview",
    details: "Details",
    versions: "Version History",
    hashes: "Hashes",
    safety: "Safety",
  };

  const safetyKey = $derived(file === null ? "clean" : safetyKeyOf(file));

  /*
   * THE NAME IS EDITED WHERE IT IS READ. Pressing the name puts a field in the name's own place, at
   * the same height, holding the name the panel was showing: Enter commits, Escape cancels, and
   * leaving the field commits too, because a name somebody typed and then clicked away from is a
   * name they meant. Nothing else in the header moves while it happens.
   *
   * It used to ask the LIST to open the field instead, which put the cursor on a row that may be
   * scrolled away or in another folder — the reader pressed the name and watched a selection happen
   * somewhere else.
   *
   * A REFUSED NAME KEEPS THE OLD ONE. The field stays open holding what was typed, the sentence the
   * host answered with stands beneath it, and the record still reads as it did — which is what makes
   * a collision fixable where it was typed rather than somewhere the reader has to go and find.
   *
   * The extension governs display and selection, never editability: with extensions hidden the field
   * holds no extension and the stored one reattaches on commit; with them shown, what was typed
   * stands, and only the stem is selected so typing immediately does not eat it.
   */
  let renaming = $state(false);
  let renameDraft = $state("");
  let renameRefusal = $state<string | null>(null);
  let renameCommitting = $state(false);
  let renameField = $state<HTMLInputElement | null>(null);

  const storedName = $derived(file === null ? (folder?.name ?? "") : file.name);
  const shownName = $derived(
    file === null ? (folder?.name ?? "") : displayName(file.name, hideExtensions),
  );
  /* A folder's whole name is its stem: there is no extension to hide or reattach. */
  const nameFieldHidesExtension = $derived(file !== null && hideExtensions);

  $effect(() => {
    // A different file or folder is a different name; a draft must never follow the selection.
    void row?.key;
    renaming = false;
    renameDraft = "";
    renameRefusal = null;
  });

  function beginRename(): void {
    if (row === null || renameCommitting) return;
    renameDraft = renameFieldValue(storedName, nameFieldHidesExtension);
    renameRefusal = null;
    renaming = true;
    // The field mounts on the next frame; the selection stops at the stem so typing keeps the
    // extension the reader can see but did not ask to change.
    queueMicrotask(() => {
      renameField?.focus();
      renameField?.setSelectionRange(
        0,
        renameSelectionEnd(renameDraft, nameFieldHidesExtension),
      );
    });
  }

  function cancelRename(): void {
    renaming = false;
    renameDraft = "";
    renameRefusal = null;
  }

  /*
   * `keepFocus` is true only for a commit the reader ASKED for (Enter). A commit that happened
   * because they clicked away must not pull them back into the field when it is refused: that is a
   * focus trap, and the reader can click the field again when they want to fix the name.
   */
  async function commitRename(keepFocus: boolean): Promise<void> {
    if (!renaming || row === null || renameCommitting) return;
    const storedExtension = file === null ? "" : splitName(file.name).extension;
    const wanted = committedRename(renameDraft, storedExtension, nameFieldHidesExtension);
    // An empty field is not a name, and the same name is not a rename: either way the field closes
    // and nothing is written, so no audit row records a change that did not happen.
    if (wanted === "" || wanted === storedName) {
      cancelRename();
      return;
    }
    renameCommitting = true;
    const refusal = await onRenameCommit(wanted);
    renameCommitting = false;
    renameRefusal = refusal;
    // The field stays open holding what was typed: the name is fixed where it was written.
    if (refusal !== null) {
      if (keepFocus) renameField?.focus();
      return;
    }
    renaming = false;
    renameDraft = "";
  }

  function renameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      // The panel sits inside the file manager's own Escape handling; this one is the field's.
      event.stopPropagation();
      cancelRename();
    }
  }

  /*
   * The shapes the Version History and Hashes tabs take while their values are read: the same rows,
   * over invented versions and digests of each algorithm's real length. Inert and hidden from
   * assistive technology while they stand, so nothing in them reads as this file's record. The
   * sample vocabulary carries no instants or digests, so those two shapes are stated here.
   */
  const VERSION_FIXTURE: readonly MatterFileVersion[] = [
    {
      id: "fixture-3",
      versionNumber: 3,
      sizeBytes: 184_320,
      sniffedContentType: null,
      contentSha256: null,
      committedAt: sampleInstant(4),
      uploadedBy: null,
      uploadedByName: null,
      saveKind: null,
      participants: [],
      scanVerdict: null,
      scanEngineVersion: null,
      scanDetail: null,
      // Two authors, so the Changes column's shape stands at its real width while the read runs.
      changes: [
        {
          authorUserId: null,
          authorName: samplePerson(0).name,
          insertions: 3,
          deletions: 2,
          formatting: 1,
        },
        { authorUserId: null, authorName: samplePerson(1).name, insertions: 1, deletions: 0, formatting: 0 },
      ],
    },
    {
      id: "fixture-2",
      versionNumber: 2,
      sizeBytes: 176_128,
      sniffedContentType: null,
      contentSha256: null,
      committedAt: sampleInstant(0),
      uploadedBy: null,
      uploadedByName: null,
      saveKind: null,
      participants: [],
      scanVerdict: null,
      scanEngineVersion: null,
      scanDetail: null,
      changes: [],
    },
  ];
  const SCAN_FIXTURE: readonly FileScanEvent[] = [
    {
      id: "fixture-scan-2",
      at: sampleInstant(1),
      event: "file.version_rescanned",
      versionId: "fixture-2",
      versionNumber: 2,
      actorUserId: null,
      actorName: null,
      scanVerdict: null,
      scanEngineVersion: null,
      scanDetail: null,
      queued: null,
    },
    {
      id: "fixture-scan-1",
      at: sampleInstant(4),
      event: "file.version_committed",
      versionId: "fixture-2",
      versionNumber: 2,
      actorUserId: null,
      actorName: null,
      scanVerdict: null,
      scanEngineVersion: null,
      scanDetail: null,
      queued: null,
    },
  ];
  const HEX_RUN = "3b7f9d1e";
  const DIGEST_FIXTURE: Readonly<Record<HashAlgorithm, string>> = {
    sha256: HEX_RUN.repeat(8),
    sha512: HEX_RUN.repeat(16),
    sha384: HEX_RUN.repeat(12),
    sha1: HEX_RUN.repeat(5),
    md5: HEX_RUN.repeat(4),
  };

  /*
   * VERSION HISTORY AS A TABLE. Each version is a row of facts the reader compares down a column
   * (when, how big, who), and the actions sit in a trailing pinned column so they never move out
   * from under the pointer. The fixture rows take the same grid while the versions are read.
   */
  const VERSION_COLUMN = {
    version: "version",
    date: "date",
    kind: "kind",
    size: "size",
    createdBy: "createdBy",
    changes: "changes",
    actions: "actions",
  } as const;
  // Every save in the editor is a version, so a history folds the autosaves by default and opens
  // them on request; what folds, and what a version is called, is decided in version-history.ts.
  let showEverySave = $state(false);
  const versionsShown = $derived(versionsToShow(versions ?? VERSION_FIXTURE, showEverySave));
  const versionsFolded = $derived(foldedCount(versions ?? []));
  const versionGrid = DataTable.createDataTableGrid<MatterFileVersion>({
    columns: () => [
      {
        id: VERSION_COLUMN.version,
        label: "Version",
        type: "number",
        filter: "none",
        anchored: true,
        value: (version) => version.versionNumber,
        text: (version) => String(version.versionNumber),
      },
      {
        id: VERSION_COLUMN.date,
        label: "Date",
        type: "date",
        filter: "none",
        value: (version) => version.committedAt,
        text: (version) => (version.committedAt === null ? "" : formatInstant(version.committedAt)),
      },
      {
        id: VERSION_COLUMN.kind,
        label: "Kind",
        type: "text",
        filter: "none",
        value: (version) => version.saveKind,
        text: (version) => saveKindText(version.saveKind),
      },
      {
        id: VERSION_COLUMN.size,
        label: "Size",
        type: "number",
        filter: "none",
        value: (version) => version.sizeBytes,
        text: (version) => formatBytes(version.sizeBytes),
      },
      {
        id: VERSION_COLUMN.createdBy,
        label: "Created By",
        type: "text",
        filter: "none",
        value: (version) => version.uploadedByName,
        text: (version) => createdByText(version),
      },
      {
        // Who changed what, one clause per author; empty where the version recorded nothing new.
        id: VERSION_COLUMN.changes,
        label: "Changes",
        type: "text",
        filter: "none",
        value: (version) => changesSummaryText(version),
      },
      {
        id: VERSION_COLUMN.actions,
        label: "Actions",
        type: "text",
        filter: "none",
        pinnedEnd: true,
        value: () => null,
        text: () => "",
      },
    ],
    rows: () => versionsShown,
    rowKey: (version) => version.id,
    initialSort: { columnId: VERSION_COLUMN.version, direction: "descending" },
    itemNoun: { singular: "version", plural: "versions" },
  });
  const currentVersionNumber = $derived(
    versions === null || versions.length === 0 ? null : Math.max(...versions.map((v) => v.versionNumber)),
  );

  /*
   * THE CHANGES OPEN IN THEIR OWN PANEL, from the row: a version's marks are a list long enough to
   * need the room, and a column can only summarise them. The control is on the rows that have any.
   */
  let changesVersion = $state<MatterFileVersion | null>(null);
  let changesOpen = $state(false);
  $effect(() => {
    // A different file is a different history; a panel open on the old one has nothing to show.
    void file?.id;
    changesOpen = false;
    changesVersion = null;
  });

  /*
   * THE HASHES TAB COMPUTES ON ENTRY. The digests are the tab's whole content, so a tab that
   * opened empty and waited for a button press asked the reader to do what the tab is for. One
   * run per file and version: the guard remembers what it asked for, so a re-render, a tab
   * switch and back, or the panel closing and reopening on the same file never starts a second
   * computation over the same bytes; Refresh and a change of version ask on purpose.
   */
  let hashVersionId = $state<string | null>(null);
  let hashRequestedFor = $state<string | null>(null);
  let expectedDigestInput = $state("");
  const hashSubjectKey = $derived(file === null ? null : `${file.id}:${hashVersionId ?? "current"}`);
  $effect(() => {
    // A new file resets the version choice to its current version.
    void file?.id;
    hashVersionId = null;
    expectedDigestInput = "";
  });
  $effect(() => {
    if (tab !== "hashes" || file === null || file.currentVersionId === null) return;
    if (integrityRunning || hashSubjectKey === null || hashRequestedFor === hashSubjectKey) return;
    if (integrity !== null && integrityVersionId === hashVersionId) return;
    hashRequestedFor = hashSubjectKey;
    onVerifyIntegrity(hashVersionId);
  });
  const hashVersionItems = $derived(
    (versions ?? []).map((version) => ({
      value: version.id,
      label:
        version.versionNumber === currentVersionNumber
          ? `Version ${version.versionNumber} (current)`
          : `Version ${version.versionNumber}`,
    })),
  );
  const hashVersionValue = $derived(
    hashVersionId ?? versions?.find((v) => v.versionNumber === currentVersionNumber)?.id ?? "",
  );
  /** The digests on screen describe the version the reader chose; otherwise they are stale. */
  const integrityShown = $derived(
    integrity !== null && integrityVersionId === hashVersionId ? integrity : null,
  );

  /*
   * COMPARE AGAINST A DIGEST THE READER WAS GIVEN. Typed, pasted (a whole sha256sum line will
   * do), or produced by hashing a file on this device; the algorithm is told from its length.
   */
  let expectedFileName = $state<string | null>(null);
  let expectedFileHashing = $state(false);
  const expectedReading = $derived(
    readExpectedDigest(expectedDigestInput, integrityShown?.algorithms ?? null),
  );
  async function hashChosenFile(event: Event): Promise<void> {
    const chosen = (event.currentTarget as HTMLInputElement).files?.[0];
    if (chosen === undefined) return;
    expectedFileHashing = true;
    const digest = await sha256OfFile(chosen);
    expectedFileHashing = false;
    if (digest === null) return;
    expectedFileName = chosen.name;
    expectedDigestInput = digest;
  }

  /*
   * THE SAFETY HISTORY AS A TABLE: one line per check, request or hold, newest first, each with
   * the engine that ran it and what it found AS RECORDED THEN — never the version's latest
   * verdict copied onto every line.
   */
  const SCAN_COLUMN = {
    at: "at",
    what: "what",
    version: "version",
    engine: "engine",
    result: "result",
    detail: "detail",
  } as const;
  const scansShown = $derived(scans?.data ?? SCAN_FIXTURE);
  const scanGrid = DataTable.createDataTableGrid<FileScanEvent>({
    columns: () => [
      {
        id: SCAN_COLUMN.at,
        label: "When",
        type: "date",
        filter: "none",
        anchored: true,
        value: (event) => event.at,
        text: (event) => formatInstant(event.at),
      },
      {
        id: SCAN_COLUMN.what,
        label: "What",
        type: "text",
        filter: "none",
        value: (event) => SCAN_EVENT_LABELS[event.event],
      },
      {
        id: SCAN_COLUMN.version,
        label: "Version",
        type: "number",
        filter: "none",
        value: (event) => event.versionNumber,
        text: (event) => String(event.versionNumber),
      },
      {
        id: SCAN_COLUMN.engine,
        label: "Engine",
        type: "text",
        filter: "none",
        value: (event) => scanEventEngineText(event),
      },
      {
        id: SCAN_COLUMN.result,
        label: "Result",
        type: "text",
        filter: "none",
        value: (event) => scanEventVerdictText(event),
      },
      {
        id: SCAN_COLUMN.detail,
        label: "Detail",
        type: "text",
        filter: "none",
        value: (event) => scanEventDetailReading(event).text,
      },
    ],
    rows: () => scansShown,
    rowKey: (event) => event.id,
    initialSort: { columnId: SCAN_COLUMN.at, direction: "descending" },
    itemNoun: { singular: "check", plural: "checks" },
  });
  const openRequest = $derived(
    scans === null
      ? false
      : scans.data.some((event) => requestIsOpen(scans.data, event)),
  );

  /** What the preview can honestly show. It never pretends to render bytes it has not been given. */
  const previewNote = $derived.by((): string => {
    if (file === null) return "";
    if (file.status === "pending") {
      return "No preview yet. The upload is stored; the first check is still running.";
    }
    if (file.status === "quarantined") {
      return "Preview withheld while a finding is open. The file is stored and can still be downloaded.";
    }
    return "The document renders here once the preview surface is wired to this panel.";
  });
</script>

<!-- The version table's cells. Every control is present at rest in the trailing pinned column,
     so the one being aimed at never moves out from under the pointer. -->
{#snippet versionCell({ row, column, text }: DataTable.GridCellContext<MatterFileVersion>)}
  {#if column.id === VERSION_COLUMN.actions}
    {@const isCurrent = row.versionNumber === currentVersionNumber}
    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        title="Open version {row.versionNumber}"
        aria-label="Open version {row.versionNumber}"
        onclick={() => onOpenVersion(row)}
      >
        <Eye class="size-16" aria-hidden="true" />
      </Button>
      {#if row.changes.length > 0}
        <Button
          variant="ghost"
          size="icon"
          title="See who changed what in version {row.versionNumber}"
          aria-label="See who changed what in version {row.versionNumber}"
          onclick={() => {
            changesVersion = row;
            changesOpen = true;
          }}
        >
          <Diff class="size-16" aria-hidden="true" />
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        title="Verify version {row.versionNumber}"
        aria-label="Verify version {row.versionNumber}"
        onclick={() => {
          hashVersionId = isCurrent ? null : row.id;
          tab = "hashes";
        }}
      >
        <Hash class="size-16" aria-hidden="true" />
      </Button>
      {#if !isCurrent}
        <Button
          variant="ghost"
          size="icon"
          disabled
          title={waitingReason("compare-versions")}
          aria-label="Compare version {row.versionNumber} with the current one"
        >
          <GitCompare class="size-16" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled
          title={waitingReason("restore-version")}
          aria-label="Restore version {row.versionNumber} as a new version"
          onclick={() => onRestoreVersion(row)}
        >
          <RotateCcw class="size-16" aria-hidden="true" />
        </Button>
      {/if}
    </div>
  {:else if column.id === VERSION_COLUMN.version}
    <span class="tabular-nums" class:font-semibold={row.versionNumber === currentVersionNumber}>
      {text}
    </span>
  {:else if column.id === VERSION_COLUMN.size}
    <span class="font-mono text-xs">{text}</span>
  {:else}
    {text}
  {/if}
{/snippet}

{#snippet scanCell({ row, column, text }: DataTable.GridCellContext<FileScanEvent>)}
  {#if column.id === SCAN_COLUMN.result}
    {#if row.event === "file.rescan_requested"}
      <!-- A request that never reached the engine is not neutral news: nothing ran, and nothing
           else on the line would have said so. -->
      <Badge
        variant={scanRequestWasNotQueued(row)
          ? "warning"
          : scans !== null && requestIsOpen(scans.data, row)
            ? "info"
            : "neutral"}
      >
        {text}
      </Badge>
    {:else}
      {@const key = scanEventStatusKey(row)}
      <Badge variant={key === null ? "neutral" : statusEntry(key).tone}>{text}</Badge>
    {/if}
  {:else if column.id === SCAN_COLUMN.detail}
    <!-- The scanner's own words stand exactly as recorded; what the PLATFORM wrote is stated in a
         reader's words instead, because a code of ours says nothing to the person auditing a file. -->
    {#if scanEventDetailReading(row).verbatim}
      <span class="font-mono text-xs break-all">{text}</span>
    {:else}
      <span class="text-xs">{text}</span>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

<!-- The raised surface sets the panel apart from the list beside it — a sidebar the same white as
     the work area reads as more work area, not as a panel. -->
<aside
  class="mc-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-sunken"
  aria-label="Details"
>
  {#if row === null}
    <!-- structured-empty-allow: nothing is SELECTED, which is not a table waiting to fill. The
         panel has no subject at all, so there is no header row to promise and no rows that would
         ever land under it; the tables inside the panel draw their own frames the moment a file is
         chosen. -->
    <div class="flex h-full items-center justify-center p-16">
      <!-- One line, standing alone: the tail explaining that details live here was saying what the
           panel's own presence already says. -->
      <EmptyState title="Select a file or folder." />
    </div>
  {:else}
    <header class="flex flex-col gap-4 border-b border-border-default p-12">
      <div class="flex items-start gap-8">
        {#if file !== null}
          <FileIcon
            contentType={file.sniffedContentType ?? undefined}
            fileName={file.name}
            class="mt-4 size-20 shrink-0"
          />
        {:else}
          <FileIcon folder class="mt-4 size-20 shrink-0" />
        {/if}
        <!-- The name is read and changed in the same place. The field takes the resting control's
             own height, so opening it moves nothing else in the header. -->
        {#if renaming}
          <Input
            bind:ref={renameField}
            bind:value={renameDraft}
            size="sm"
            class="min-w-0 flex-1"
            aria-label="New name"
            aria-invalid={renameRefusal !== null}
            readonly={renameCommitting}
            onkeydown={renameKeydown}
            onblur={() => void commitRename(false)}
          />
        {:else}
          <Button
            variant="ghost"
            size="sm"
            class="min-w-0 flex-1 justify-start text-start"
            title="Rename"
            onclick={beginRename}
          >
            <span class="truncate">{shownName}</span>
          </Button>
        {/if}
        <Button variant="ghost" size="icon" aria-label="Close details" onclick={onClose}>
          <X class="size-16" aria-hidden="true" />
        </Button>
      </div>
      {#if renameRefusal !== null}
        <!-- The refusal stands where the name was typed, in the subtle register a work surface
             states a refusal in, and the record still holds the name it had. -->
        <p class="text-xs text-status-danger-subtle-foreground">{renameRefusal}</p>
      {/if}
    </header>

    {#if folder !== null}
      {@const aggregate = folderAggregateOf(folder.id)}
      <!-- A folder shows what is inside it. It does not show an Open/Download/deletion-rules block:
           the breadcrumb already says where it is, and the acts live in the right-click. -->
      <div class="flex flex-col gap-12 p-12">
        <dl class="flex flex-col gap-8 text-sm">
          <div class="flex items-baseline gap-16">
            <dt class="w-96 shrink-0 text-text-muted">Files</dt>
            <dd>{aggregate.fileCount}</dd>
          </div>
          <div class="flex items-baseline gap-16">
            <dt class="w-96 shrink-0 text-text-muted">Folders</dt>
            <dd>{aggregate.folderCount}</dd>
          </div>
          <div class="flex items-baseline gap-16">
            <dt class="w-96 shrink-0 text-text-muted">Size</dt>
            <dd>{folderSizeText(aggregate)}</dd>
          </div>
          <div class="flex items-baseline gap-16">
            <dt class="w-96 shrink-0 text-text-muted">Date Modified</dt>
            <dd>
              {aggregate.latestModified === null ? "" : formatInstant(aggregate.latestModified)}
            </dd>
          </div>
          <div class="flex items-baseline gap-16">
            <dt class="w-96 shrink-0 text-text-muted">Safety</dt>
            <dd><SafetyMark verdict={aggregate.safety} /></dd>
          </div>
        </dl>
      </div>
    {:else if file !== null}
      <Tabs.Root bind:value={() => tab, (next) => (tab = next as InspectorTab)}>
        <!-- The strip scrolls SIDEWAYS only. It is tall enough for its own horizontal scrollbar,
             so no vertical one ever appears; it never wraps to a second row. -->
        <div class="mc-scrollbar overflow-x-auto">
          <Tabs.List class="w-max">
            {#each INSPECTOR_TABS as name (name)}
              <Tabs.Trigger value={name}>{TAB_LABELS[name]}</Tabs.Trigger>
            {/each}
          </Tabs.List>
        </div>

        <Tabs.Content value="preview">
          <div class="p-12">
            <div
              class="flex min-h-96 items-center justify-center rounded-md bg-surface-sunken p-16 text-center text-sm text-text-muted"
            >
              {previewNote}
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="details">
          <dl class="flex flex-col gap-8 p-12 text-sm">
            <div class="flex items-baseline gap-16">
              <dt class="w-96 shrink-0 text-text-muted">Type</dt>
              <dd>
                {fileExtension(file)}
                {#if file.sniffedContentType !== null}
                  <span class="text-text-subtle">· {file.sniffedContentType}</span>
                {/if}
              </dd>
            </div>
            <div class="flex items-baseline gap-16">
              <dt class="w-96 shrink-0 text-text-muted">Current Version</dt>
              <dd>{file.currentVersionId === null ? "None yet" : file.versionNumber}</dd>
            </div>
            <div class="flex items-baseline gap-16">
              <dt class="w-96 shrink-0 text-text-muted">Size</dt>
              <dd>{formatBytes(file.sizeBytes)}</dd>
            </div>
            <div class="flex items-baseline gap-16">
              <dt class="w-96 shrink-0 text-text-muted">Date Created</dt>
              <dd>{formatInstant(file.createdAt)}</dd>
            </div>
            <div class="flex items-baseline gap-16">
              <dt class="w-96 shrink-0 text-text-muted">Created By</dt>
              <!-- Blank rather than a stand-in word where nobody was recorded, as the table reads it. -->
              <dd>{file.uploadedByName ?? ""}</dd>
            </div>
            <div class="flex items-baseline gap-16">
              <dt class="w-96 shrink-0 text-text-muted">Date Modified</dt>
              <dd>{formatInstant(file.updatedAt)}</dd>
            </div>
            {#if file.sourceModifiedAt !== null}
              <!-- The last-modified date the file carried on the device it was uploaded from, as
                   distinct from Date Created (when the record was made here). Shown only where
                   one was recorded: an empty row would read as a fact the platform failed to
                   collect, and for a file made here there is no such fact. -->
              <div class="flex items-baseline gap-16">
                <dt
                  class="w-96 shrink-0 text-text-muted"
                  title="The last-modified date the file carried on the device it came from"
                >
                  Source File Date
                </dt>
                <dd>{formatInstant(file.sourceModifiedAt)}</dd>
              </div>
            {/if}
            <div class="flex items-baseline gap-16">
              <dt class="w-96 shrink-0 text-text-muted">Document Type</dt>
              <dd>
                <!-- The field a reader reads is the field they expect to click, and it opens a
                     dropdown anchored to itself rather than a dialog. An unset type is BLANK and
                     keeps its labelled, clickable footprint. -->
                <DocumentTypeMenu
                  {documentTypes}
                  chosenDocumentTypeId={file.documentTypeId}
                  onPick={onPickDocumentType}
                  onAdd={onAddDocumentType}
                >
                  {#snippet trigger()}
                    <span class={buttonClasses({ variant: "ghost", size: "sm" })}>
                      {documentTypeName(file.documentTypeId)}
                    </span>
                  {/snippet}
                </DocumentTypeMenu>
              </dd>
            </div>
            {#if safetyKey === "error"}
              <!-- An open finding is ONE ROW LIKE EVERY OTHER: a flag whose click opens Safety.
                   The detail lives there, and this tab carries no safety sentence. -->
              <div class="flex items-baseline gap-16">
                <dt class="w-96 shrink-0 text-text-muted">Safety</dt>
                <dd>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Open finding: open the Safety tab"
                    aria-label="Open finding: open the Safety tab"
                    onclick={() => (tab = "safety")}
                  >
                    <Flag class="size-16" aria-hidden="true" />
                  </Button>
                </dd>
              </div>
            {/if}
          </dl>
        </Tabs.Content>

        <Tabs.Content value="versions">
          <LoadingRegion
            loading={versionsLoading}
            failed={versionsFailure !== null}
            label="Reading this file's versions"
            onRetry={onRetryVersions}
            class="flex flex-col gap-8 p-12"
          >
            {#snippet failure()}
              {#if versionsFailure !== null}
                <FailureNotice
                  failure={versionsFailure}
                  subject="This file's versions"
                  onRetry={onRetryVersions}
                />
              {/if}
            {/snippet}
            {#snippet fixture()}
              <DataTable.Grid
                grid={versionGrid}
                cell={versionCell}
                density="compact"
                caption="This file's versions"
              />
            {/snippet}
            {#if versionsFolded > 0}
              <!-- The fold: the line that says how many autosaves are hidden, and opens them. Above
                   the grid rather than inside it, because the grid's rows are versions and this is
                   a fact about the view. -->
              <div class="flex items-center justify-between gap-8 text-sm text-text-muted">
                <span>{showEverySave ? "Every save shown" : foldedLabel(versionsFolded)}</span>
                <Button variant="ghost" size="sm" onclick={() => (showEverySave = !showEverySave)}>
                  {showEverySave ? "Fold the autosaves" : "Show every save"}
                </Button>
              </div>
            {/if}
            <DataTable.Grid
              grid={versionGrid}
              cell={versionCell}
              density="compact"
              caption="This file's versions"
            />
          </LoadingRegion>
          <VersionChangesDialog bind:open={changesOpen} fileId={file.id} version={changesVersion} />
        </Tabs.Content>

        <Tabs.Content value="hashes">
          <div class="flex flex-col gap-12 p-12">
              <!-- Which version the digests describe. The current version unless the reader picks
                   an earlier one; picking one computes its digests at once. -->
              <div class="flex items-center gap-8">
                <div class="min-w-0 flex-1">
                  <Select.Root
                    type="single"
                    items={hashVersionItems}
                    allowDeselect={false}
                    disabled={versions === null || versions.length === 0}
                    bind:value={
                      () => hashVersionValue,
                      (next) => {
                        const chosen = versions?.find((v) => v.id === next);
                        hashVersionId =
                          chosen === undefined || chosen.versionNumber === currentVersionNumber
                            ? null
                            : chosen.id;
                      }
                    }
                  >
                    <Select.Trigger aria-label="Version to digest">
                      <Select.Value placeholder="Current version" />
                    </Select.Trigger>
                    <Select.Content>
                      {#each hashVersionItems as option (option.value)}
                        <Select.Item value={option.value} label={option.label} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Recompute the digests"
                  aria-label="Recompute the digests"
                  disabled={integrityRunning}
                  onclick={() => onVerifyIntegrity(hashVersionId)}
                >
                  <RefreshCw class="size-16" aria-hidden="true" />
                </Button>
              </div>

              <!-- The list stands before its values: every algorithm is a term from the start, each
                   with an empty definition until its digest lands, and the words about why sit
                   beneath the terms inside the list. While the digests are being computed the rows
                   stand in their own shape, each at its algorithm's length; a recompute keeps the
                   digests already on screen in view until the fresh ones land. -->
              <LoadingRegion
                loading={integrityShown === null && integrityRunning}
                refreshing={integrityShown !== null && integrityRunning}
                label="Computing the digests"
              >
                {#snippet fixture()}
                  <DefinitionList.Root class="text-xs">
                    {#each HASH_ALGORITHMS as algorithm (algorithm)}
                      <DefinitionList.Row term={algorithm.toUpperCase()}>
                        <span class="font-mono">{DIGEST_FIXTURE[algorithm]}</span>
                      </DefinitionList.Row>
                  {/each}
                </DefinitionList.Root>
              {/snippet}
              <DefinitionList.Root class="text-xs">
                {#each HASH_ALGORITHMS as algorithm (algorithm)}
                  <DefinitionList.Row term={algorithm.toUpperCase()} empty={integrityShown === null}>
                    <span class="font-mono">{integrityShown?.algorithms[algorithm]}</span>
                  </DefinitionList.Row>
                {/each}
                {#if file.currentVersionId === null}
                  <DefinitionList.Empty>
                    Nothing to digest yet: no version has been committed.
                  </DefinitionList.Empty>
                {:else if integrityShown === null}
                  <DefinitionList.Empty>Not computed yet.</DefinitionList.Empty>
                {/if}
              </DefinitionList.Root>
            </LoadingRegion>

              {#if integrityShown !== null && integrityShown.comparison === "mismatch"}
                <!-- A difference between what intake recorded and what the bytes digest to now is
                     a chain-of-custody event, so it names BOTH values and does not whisper. -->
                <Alert.Root variant="danger">
                  <Alert.Title>These Bytes Are Not the Bytes That Were Filed</Alert.Title>
                  <Alert.Description>
                    <span class="block font-mono break-all">
                      Recorded at intake: {integrityShown.baselineSha256}
                    </span>
                    <span class="block font-mono break-all">
                      Computed now: {integrityShown.algorithms.sha256}
                    </span>
                  </Alert.Description>
                </Alert.Root>
              {:else if integrityShown !== null && integrityShown.comparison === "no-baseline"}
                <!-- Never fake agreement: this file came in before intake recorded a digest. -->
                <Alert.Root variant="info">
                  <Alert.Title>There Is Nothing to Compare Against</Alert.Title>
                  <Alert.Description>
                    This version was filed before a digest was recorded at intake, so the values
                    above stand on their own.
                  </Alert.Description>
                </Alert.Root>
              {/if}

              <Separator />

              <!-- A digest the reader was handed — by a court, a vendor, opposing counsel — held
                   against the version on screen. Which algorithm it is comes from its length, so
                   nobody has to say. A file on this device can stand in for typing: its SHA-256 is
                   computed here and never leaves the browser. -->
              <div class="flex flex-col gap-8">
                <Label for="inspector-expected-digest">Compare Against a Digest You Were Given</Label>
                <Textarea
                  id="inspector-expected-digest"
                  rows={2}
                  class="font-mono text-xs"
                  placeholder={placeholderOf("Digest")}
                  bind:value={expectedDigestInput}
                />
                <p class="text-xs text-text-subtle">
                  Type or paste the digest; a whole checksum line, file name and all, is fine.
                </p>
                <div class="flex flex-wrap items-center gap-8">
                  <FileInput
                    aria-label="Hash a file on this device and compare its SHA-256"
                    disabled={expectedFileHashing}
                    onchange={(event) => void hashChosenFile(event)}
                  />
                  {#if expectedFileHashing}
                    <span class="text-xs text-text-muted">Hashing the file on this device.</span>
                  {:else if expectedFileName !== null}
                    <span class="text-xs text-text-muted">SHA-256 of {expectedFileName}</span>
                  {/if}
                </div>
                {#if expectedReading.kind !== "empty"}
                  <div class="flex items-center gap-8 text-xs">
                    <Badge
                      variant={expectedReading.kind === "match"
                        ? "success"
                        : expectedReading.kind === "mismatch"
                          ? "danger"
                          : expectedReading.kind === "unrecognised"
                            ? "warning"
                            : "neutral"}
                    >
                      {expectedReading.kind === "match"
                        ? "Match"
                        : expectedReading.kind === "mismatch"
                          ? "Mismatch"
                          : expectedReading.kind === "unrecognised"
                            ? "Not a Digest"
                            : "Waiting"}
                    </Badge>
                    <span class="text-text-muted">{expectedDigestText(expectedReading)}</span>
                  </div>
                {/if}
              </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="safety">
          <div class="flex flex-col gap-12 p-12">
            <div class="flex items-center justify-between gap-8">
              <SafetyMark verdict={safetyKey} />
              <!-- The reader can ask for the engine to look again, whatever the standing verdict.
                   The request lands in the history at once; the verdict follows in the background. -->
              <Button
                variant="secondary"
                size="sm"
                disabled={rescanRunning || file.currentVersionId === null || openRequest}
                title={openRequest ? "A check is already on its way." : "Check this file again now"}
                onclick={() => onRescan(null)}
              >
                <ShieldCheck class="size-16" aria-hidden="true" />
                {openRequest ? "Checking" : "Check Again"}
              </Button>
            </div>
            {#if file.quarantineReason !== null}
              <!-- The scanner's own words, never our cheerful paraphrase of them. -->
              <p class="rounded-md bg-surface-sunken p-8 font-mono text-xs break-all">
                {file.quarantineReason}
              </p>
            {/if}
            <p class="text-sm text-text-muted">
              {statusEntry(safetyKey).meaning}
            </p>
            <Separator />
            <!-- Every check this file has had, with the engine that ran it and what it found as
                 recorded at the time. Newest first, so an open request is the top line for its
                 version until the verdict lands beneath it. -->
            <LoadingRegion
              loading={scansLoading && scans === null}
              refreshing={scansLoading && scans !== null}
              failed={scansFailure !== null}
              label="Reading this file's checks"
              onRetry={onRetryScans}
              class="flex flex-col gap-8"
            >
              {#snippet failure()}
                {#if scansFailure !== null}
                  <FailureNotice
                    failure={scansFailure}
                    subject="This file's checks"
                    onRetry={onRetryScans}
                  />
                {/if}
              {/snippet}
              {#snippet fixture()}
                <DataTable.Grid
                  grid={scanGrid}
                  cell={scanCell}
                  density="compact"
                  caption="This file's checks"
                />
              {/snippet}
              <DataTable.Grid
                grid={scanGrid}
                cell={scanCell}
                density="compact"
                caption="This file's checks"
              />
            </LoadingRegion>

            <Separator />

            <!-- WHAT A CHECK RUNS UNDER. The history says what each check found; this says what it
                 was looking with — the engine decomposed into the three things it is made of, and
                 the four settings that decide which matches count and what happens to a file that
                 has one. Every term stands from the first paint with its value empty, so a reader
                 meets the shape before the values land. The last row is the honest one: only the
                 engine is recorded per check, and a reader auditing a verdict has to know which of
                 these numbers describes their file and which describes the firm today. -->
            <LoadingRegion
              loading={scans === null && scansLoading}
              label="Reading what the firm checks with"
            >
              {#snippet fixture()}
                <DefinitionList.Root class="text-sm">
                  {#each scanEngineReadingLines(SCAN_ENGINE_FIXTURE_PARTS) as line (line.label)}
                    <DefinitionList.Row term={line.label}>{line.value}</DefinitionList.Row>
                  {/each}
                  {#each scanSettingsLines(SCAN_SETTINGS_FIXTURE) as line (line.label)}
                    <DefinitionList.Row term={line.label}>{line.value}</DefinitionList.Row>
                  {/each}
                </DefinitionList.Root>
              {/snippet}
              {@const engineComposite = scans === null ? null : scans.currentEngineVersion}
              {@const engineParts =
                engineComposite === null ? null : decomposeScanEngineVersion(engineComposite)}
              <DefinitionList.Root class="text-sm">
                {#each scanEngineReadingLines(engineParts ?? SCAN_ENGINE_FIXTURE_PARTS) as line (line.label)}
                  <DefinitionList.Row term={line.label} empty={engineParts === null}>
                    <span class="font-mono tabular-nums">{line.value}</span>
                  </DefinitionList.Row>
                {/each}
                {#each scanSettingsLines(scans?.scanSettings ?? SCAN_SETTINGS_FIXTURE) as line (line.label)}
                  <DefinitionList.Row term={line.label} empty={scans === null}>
                    {line.value}
                  </DefinitionList.Row>
                {/each}
                <DefinitionList.Row term={SCAN_SETTINGS_PROVENANCE_LABEL}>
                  {SCAN_SETTINGS_PROVENANCE}
                </DefinitionList.Row>
                {#if scans !== null && engineParts === null}
                  <DefinitionList.Empty term="Scan engine">
                    {SCAN_ENGINE_UNREPORTED_DETAIL}
                  </DefinitionList.Empty>
                {/if}
              </DefinitionList.Root>
            </LoadingRegion>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    {/if}
  {/if}
</aside>
