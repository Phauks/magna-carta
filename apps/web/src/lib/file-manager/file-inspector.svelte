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
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import DigestList, { type DigestEntry } from "@magna-carta/design-system/digest-list";
  import Separator from "@magna-carta/design-system/separator";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { statusEntry } from "@magna-carta/design-system/status-register";
  import SafetyMark from "./safety-mark.svelte";
  import DocumentTypeMenu from "./document-type-menu.svelte";
  import Flag from "@lucide/svelte/icons/flag";
  import Eye from "@lucide/svelte/icons/eye";
  import Hash from "@lucide/svelte/icons/hash";
  import GitCompare from "@lucide/svelte/icons/git-compare";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import X from "@lucide/svelte/icons/x";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import type { FileManagerRow, FolderAggregate } from "./file-rows.ts";
  import { folderSizeText, formatBytes } from "./file-rows.ts";
  import { fileExtension, safetyKeyOf } from "./file-columns.ts";
  import { displayName } from "./file-names.ts";
  import { countPhrase } from "./file-manager-vocabulary.ts";
  import { waitingReason } from "./file-manager-availability.ts";
  import {
    HASH_ALGORITHMS,
    type DocumentTypeSummary,
    type IntegrityVerification,
    type MatterFile,
    type MatterFileVersion,
  } from "./matter-file-api.ts";
  import { INSPECTOR_TABS, type InspectorTab } from "./file-manager-state.svelte.ts";

  /*
   * The algorithms as the standards name them, against the lowercase keys the record uses. The two
   * vocabularies both have a reason to exist — a JSON field is not a heading — so the mapping is
   * stated once here rather than being approximated by upper-casing the key, which would print
   * "SHA256" and "MD-5".
   */
  const DIGEST_LABEL: Record<(typeof HASH_ALGORITHMS)[number], string> = {
    sha256: "SHA-256",
    sha512: "SHA-512",
    sha384: "SHA-384",
    sha1: "SHA-1",
    md5: "MD5",
  };

  let {
    row,
    hideExtensions,
    documentTypeName,
    documentTypes,
    versions,
    versionsLoading,
    integrity,
    integrityRunning,
    folderAggregateOf,
    tab = $bindable("details"),
    onClose,
    onRename,
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
    integrity: IntegrityVerification | null;
    integrityRunning: boolean;
    folderAggregateOf: (folderId: string) => FolderAggregate;
    tab?: InspectorTab;
    onClose: () => void;
    onRename: () => void;
    onPickDocumentType: (documentTypeId: string | null) => void;
    onAddDocumentType: (name: string) => void;
    onVerifyIntegrity: () => void;
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

  // Order is the record's: the primary digest first, the legacy-interop pair last. The list holds
  // every row whether or not its value has landed, so nothing below it moves as they arrive.
  const digestEntries = $derived(
    HASH_ALGORITHMS.map(
      (algorithm): DigestEntry => ({
        algorithm: DIGEST_LABEL[algorithm],
        value: integrity === null ? null : integrity.algorithms[algorithm],
      }),
    ),
  );

  async function copyDigest(entry: DigestEntry): Promise<void> {
    if (entry.value !== null) await navigator.clipboard.writeText(entry.value);
  }
</script>

<!-- The raised surface sets the panel apart from the list beside it — a sidebar the same white as
     the work area reads as more work area, not as a panel. -->
<aside
  class="mc-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-sunken"
  aria-label="Details"
>
  {#if row === null}
    <div class="flex h-full items-center justify-center p-16">
      <!-- One line, standing alone: the tail explaining that details live here was saying what the
           panel's own presence already says. -->
      <EmptyState title="Select a file or folder." />
    </div>
  {:else}
    <header class="flex items-start gap-8 border-b border-border-default p-12">
      {#if file !== null}
        <FileIcon
          contentType={file.sniffedContentType ?? undefined}
          fileName={file.name}
          class="mt-4 size-20 shrink-0"
        />
      {:else}
        <FileIcon folder class="mt-4 size-20 shrink-0" />
      {/if}
      <!-- Clicking the name renames it, so the field a reader reads is the field they can edit. -->
      <Button
        variant="ghost"
        size="sm"
        class="min-w-0 flex-1 justify-start text-start"
        title="Rename"
        onclick={onRename}
      >
        <span class="truncate">
          {file === null ? (folder?.name ?? "") : displayName(file.name, hideExtensions)}
        </span>
      </Button>
      <Button variant="ghost" size="icon" aria-label="Close details" onclick={onClose}>
        <X class="size-16" aria-hidden="true" />
      </Button>
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
              <dt class="w-96 shrink-0 text-text-muted">Date Modified</dt>
              <dd>{formatInstant(file.updatedAt)}</dd>
            </div>
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
          <div class="flex flex-col gap-8 p-12">
            {#if versionsLoading}
              <Skeleton class="h-48 w-full" />
              <Skeleton class="h-48 w-full" />
            {:else if versions === null || versions.length === 0}
              <p class="text-sm text-text-muted">
                No committed version yet: the first check is still running. The bytes are saved.
              </p>
            {:else}
              {#each versions as version, index (version.id)}
                <!-- The row does NOT reflow on hover: every control is present at rest, so the one
                     being aimed at never moves out from under the pointer. -->
                <div class="flex items-center gap-8 rounded-md px-4 py-8">
                  <span class="w-40 text-sm tabular-nums" class:font-semibold={index === 0}>
                    {version.versionNumber}
                  </span>
                  <span class="min-w-0 flex-1 text-xs text-text-muted">
                    <span class="block">
                      {version.committedAt === null ? "" : formatInstant(version.committedAt)}
                    </span>
                    <span class="block font-mono">{formatBytes(version.sizeBytes)}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Open version {version.versionNumber}"
                    aria-label="Open version {version.versionNumber}"
                    onclick={() => onOpenVersion(version)}
                  >
                    <Eye class="size-16" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Verify version {version.versionNumber}"
                    aria-label="Verify version {version.versionNumber}"
                    disabled={index !== 0}
                    onclick={() => {
                      tab = "hashes";
                      onVerifyIntegrity();
                    }}
                  >
                    <Hash class="size-16" aria-hidden="true" />
                  </Button>
                  {#if index !== 0}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled
                      title={waitingReason("compare-versions")}
                      aria-label="Compare version {version.versionNumber} with the current one"
                    >
                      <GitCompare class="size-16" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled
                      title={waitingReason("restore-version")}
                      aria-label="Restore version {version.versionNumber} as a new version"
                      onclick={() => onRestoreVersion(version)}
                    >
                      <RotateCcw class="size-16" aria-hidden="true" />
                    </Button>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </Tabs.Content>

        <Tabs.Content value="hashes">
          <div class="flex flex-col gap-12 p-12">
            <div class="flex items-center justify-between gap-8">
              <p class="text-xs text-text-muted">
                Recomputed from the bytes at rest, not read back from the record.
              </p>
              <Button
                variant="ghost"
                size="icon"
                title="Recompute the digests"
                aria-label="Recompute the digests"
                disabled={integrityRunning || file.currentVersionId === null}
                onclick={onVerifyIntegrity}
              >
                <RefreshCw class="size-16" aria-hidden="true" />
              </Button>
            </div>

            {#if file.currentVersionId === null}
              <p class="text-sm text-text-muted">
                Nothing to digest yet: no version has been committed.
              </p>
            {:else}
              <!-- Every algorithm row is here before a value is: the reader is told what is coming
                   rather than surprised by it arriving. DigestList holds that promise for both
                   surfaces that show digests, so neither drifts from the other. -->
              <DigestList
                digests={digestEntries}
                pending={integrityRunning}
                onCopy={(entry) => void copyDigest(entry)}
              />

              {#if integrity !== null && integrity.comparison === "mismatch"}
                <!-- A difference between what intake recorded and what the bytes digest to now is
                     a chain-of-custody event, so it names BOTH values and does not whisper. -->
                <Alert.Root variant="danger">
                  <Alert.Title>These Bytes Are Not the Bytes That Were Filed</Alert.Title>
                  <Alert.Description>
                    <span class="block font-mono break-all">
                      Recorded at intake: {integrity.baselineSha256}
                    </span>
                    <span class="block font-mono break-all">
                      Computed now: {integrity.algorithms.sha256}
                    </span>
                  </Alert.Description>
                </Alert.Root>
              {:else if integrity !== null && integrity.comparison === "no-baseline"}
                <!-- Never fake agreement: this file came in before intake recorded a digest. -->
                <Alert.Root variant="info">
                  <Alert.Title>There Is Nothing to Compare Against</Alert.Title>
                  <Alert.Description>
                    This version was filed before a digest was recorded at intake, so the values
                    above stand on their own.
                  </Alert.Description>
                </Alert.Root>
              {/if}
            {/if}
          </div>
        </Tabs.Content>

        <Tabs.Content value="safety">
          <div class="flex flex-col gap-12 p-12">
            <div class="flex items-center gap-8">
              <SafetyMark verdict={safetyKey} />
            </div>
            {#if file.quarantineReason !== null}
              <!-- The scanner's own words, never our cheerful paraphrase of them. -->
              <p class="rounded-md bg-surface-sunken p-8 font-mono text-xs break-all">
                {file.quarantineReason}
              </p>
            {/if}
            <Separator />
            <p class="text-sm text-text-muted">
              {statusEntry(safetyKey).meaning}
            </p>
            <p class="text-xs text-text-subtle">
              Safety has a history, and the per-file history feed is not served yet, so what is above
              is the current verdict alone.
            </p>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    {/if}
  {/if}
</aside>
