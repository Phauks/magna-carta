<script lang="ts">
  /*
   * One document, opened: its version history, the way to save a new version, and the way to open
   * it in the browser editor.
   *
   * The editor deserves a note. Opening it is a REAL operation — the document moves to co-editing,
   * the open is written to the audit log, and a signed token scoped to that one version is minted —
   * but the editor UI itself is served by a per-document container in the magna-carta-edit worker,
   * which exists only in a deployed environment. So the launch is made for real and the frame is
   * rendered against the origin the host named, with the gap stated beside it. That is deliberately
   * not the same thing as hiding the button: the button works, and what it reaches may not be there.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    listDocumentVersions,
    openEditSession,
    type DocumentSummary,
    type DocumentVersion,
    type EditSessionLaunch,
  } from "./document-api.ts";
  import { uploadDocument, type CreationOutcome, type CreationStage } from "./create-document.ts";
  import {
    formatDocumentSize,
    formatDocumentTimestamp,
    hasReadableContent,
    problemGuidance,
  } from "./document-presentation.ts";
  import { loopStep } from "./document-loop-availability.ts";

  let {
    document: subject,
    onVersionSaved,
  }: {
    document: DocumentSummary;
    /** Called once new bytes have landed, so the matter's list can re-read. */
    onVersionSaved: () => void;
  } = $props();

  let versions = $state<readonly DocumentVersion[] | null>(null);
  let versionsFailure = $state<StatedFailure | null>(null);
  // True while the history on screen is being read again — after a save, the same document one
  // version further on. The rows stay where the reader is looking until the fresh ones land.
  let versionsRefreshing = $state(false);
  // The document whose history is on screen, so a re-read of the same one keeps its rows in view
  // and a different one starts from the shape.
  let shownFileId: string | null = null;
  let replacementFile = $state<File | null>(null);
  let saveStage = $state<CreationStage | null>(null);
  let saveOutcome = $state<CreationOutcome | null>(null);
  let launch = $state<EditSessionLaunch | null>(null);
  let launchProblem = $state<string | null>(null);
  let launching = $state(false);

  const editorStep = loopStep("edit-in-browser");
  const readable = $derived(hasReadableContent(subject));
  const saving = $derived(saveStage !== null && saveStage !== "settled");

  /*
   * The shape the history takes while it is read: the same table, over invented versions. Inert
   * and hidden from assistive technology while it stands, so no row in it reads as a version this
   * document has. The sample vocabulary carries no instants or digests, so those two shapes are
   * stated here at their real length.
   */
  const VERSIONS_FIXTURE: readonly DocumentVersion[] = [
    {
      id: "fixture-3",
      versionNumber: 3,
      sizeBytes: 184_320,
      sniffedContentType: null,
      contentSha256: "9f3c1e7ab52d0468c1d2e3f4a5b6c7d8",
      committedAt: sampleInstant(4),
    },
    {
      id: "fixture-2",
      versionNumber: 2,
      sizeBytes: 176_128,
      sniffedContentType: null,
      contentSha256: "4b8e2d61f7a90c35d4e5f6a7b8c9d0e1",
      committedAt: sampleInstant(0),
    },
    {
      id: "fixture-1",
      versionNumber: 1,
      sizeBytes: 171_008,
      sniffedContentType: null,
      contentSha256: "d17a5c0e3b9f6248e5f6a7b8c9d0e1f2",
      committedAt: sampleInstant(1),
    },
  ];

  /** Read the history of the document on screen. Retry asks again for the same document. */
  function readVersions(): void {
    const fileId = subject.id;
    if (fileId !== shownFileId) {
      shownFileId = fileId;
      versions = null;
    }
    versionsFailure = null;
    versionsRefreshing = versions !== null;
    void (async () => {
      const result = await listDocumentVersions(fetch, fileId);
      // A document the person has already moved past says nothing about the one on screen.
      if (subject.id !== fileId) return;
      versionsRefreshing = false;
      if (result.kind === "ok") {
        versions = result.value.data;
        return;
      }
      versionsFailure = stated(result.failure, "The version history could not be read.");
    })();
  }

  $effect(() => {
    // Both are read so the history re-reads on either change: the panel is reused as the person
    // moves down the list (a new identity), and it must also follow a save (the same document, one
    // version further on). Depending on the identity alone would leave stale history on screen.
    void subject.id;
    void subject.versionNumber;
    readVersions();
  });

  async function saveNewVersion(): Promise<void> {
    if (replacementFile === null) return;
    saveOutcome = null;
    saveOutcome = await uploadDocument({
      fetchImpl: fetch,
      matterId: subject.matterId,
      fileId: subject.id,
      file: replacementFile,
      onStage: (next) => (saveStage = next),
    });
    saveStage = "settled";
    onVersionSaved();
  }

  async function openInEditor(): Promise<void> {
    launching = true;
    launchProblem = null;
    const result = await openEditSession(fetch, subject.id);
    launching = false;
    if (result.kind === "ok") {
      launch = result.value;
      return;
    }
    launchProblem =
      result.kind === "transport"
        ? "Nothing answered when the editing session was opened."
        : problemGuidance(result.problem).message;
  }
</script>

{#snippet versionTable(rows: readonly DocumentVersion[])}
  <div class="overflow-x-auto">
    <DataTable.Root>
      <DataTable.Caption class="sr-only">
        Committed versions of {subject.name}
      </DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head data-align="end">Version</DataTable.Head>
          <DataTable.Head data-align="end">Size</DataTable.Head>
          <DataTable.Head>Committed</DataTable.Head>
          <DataTable.Head>Content hash</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each rows as version (version.id)}
          <DataTable.Row>
            <DataTable.Cell data-align="end">{version.versionNumber}</DataTable.Cell>
            <DataTable.Cell data-align="end">
              {formatDocumentSize(version.sizeBytes)}
            </DataTable.Cell>
            <DataTable.Cell>{formatDocumentTimestamp(version.committedAt)}</DataTable.Cell>
            <DataTable.Cell>
              <span class="font-mono text-xs text-text-muted">
                {version.contentSha256 === null ? "—" : version.contentSha256.slice(0, 12)}
              </span>
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  </div>
{/snippet}

<div class="flex flex-col gap-24">
  <section class="flex flex-col gap-12">
    <h3 class="text-base font-semibold">Versions</h3>
    <LoadingRegion
      loading={versions === null}
      refreshing={versionsRefreshing}
      failed={versionsFailure !== null}
      empty={versions !== null && versions.length === 0}
      label="Reading this document's versions"
      onRetry={readVersions}
    >
      {#snippet failure()}
        {#if versionsFailure !== null}
          <FailureNotice
            failure={versionsFailure.failure}
            subject="The version history"
            fallback={versionsFailure.fallback}
            onRetry={readVersions}
          >
            The document itself is unaffected.
          </FailureNotice>
        {/if}
      {/snippet}
      {#snippet fixture()}
        {@render versionTable(VERSIONS_FIXTURE)}
      {/snippet}
      {#snippet emptyState()}
        <p class="text-sm text-text-muted">
          No committed version yet — nothing has cleared the check.
        </p>
      {/snippet}
      {@render versionTable(versions ?? [])}
    </LoadingRegion>
  </section>

  <section class="flex flex-col gap-12">
    <h3 class="text-base font-semibold">Save a new version</h3>
    <p class="max-w-prose text-sm text-text-muted">
      Put the edited document back. A version is never overwritten — the returning bytes are checked
      and then kept as the next version, and the history above gains a row.
    </p>
    <Dropzone
      label="Choose the edited document"
      prompt="Drag the edited document here, or use the button"
      disabled={saving}
      onFiles={(files) => {
        replacementFile = files[0] ?? null;
        saveOutcome = null;
        saveStage = null;
      }}
    />
    {#if replacementFile !== null}
      <p class="text-sm text-text-muted">Ready to save: {replacementFile.name}</p>
    {/if}
    <Button class="self-start" disabled={replacementFile === null || saving} onclick={saveNewVersion}>
      Save new version
    </Button>
    {#if saving}
      <p class="text-sm text-text-muted" role="status" aria-live="polite">Saving…</p>
    {/if}
    {#if saveOutcome !== null}
      {#if saveOutcome.kind === "created"}
        <Alert.Root variant="success">
          <Alert.Title>Saved.</Alert.Title>
          <Alert.Description>The new version is in the history above.</Alert.Description>
        </Alert.Root>
      {:else if saveOutcome.kind === "rejected"}
        <Alert.Root variant="danger">
          <Alert.Title>Those bytes were rejected.</Alert.Title>
          <Alert.Description>
            {saveOutcome.reason ?? "The scan refused them."} The document's current version is
            unchanged.
          </Alert.Description>
        </Alert.Root>
      {:else if saveOutcome.kind === "still-settling"}
        <Alert.Root variant="info">
          <Alert.Title>Still being checked.</Alert.Title>
          <Alert.Description>The history will show it once it settles.</Alert.Description>
        </Alert.Root>
      {:else if saveOutcome.kind === "transport"}
        <Alert.Root variant="danger">
          <Alert.Title>Nothing answered.</Alert.Title>
          <Alert.Description>The bytes did not reach the server.</Alert.Description>
        </Alert.Root>
      {:else}
        {@const guidance = problemGuidance(saveOutcome.problem)}
        <Alert.Root variant={guidance.tone === "info" ? "info" : guidance.tone}>
          <Alert.Title>{guidance.title}</Alert.Title>
          <Alert.Description>{guidance.message}</Alert.Description>
        </Alert.Root>
      {/if}
    {/if}
  </section>

  <section class="flex flex-col gap-12">
    <div class="flex flex-wrap items-center gap-8">
      <h3 class="text-base font-semibold">Edit in the browser</h3>
      <Badge variant="warning">Needs the deployed editor</Badge>
    </div>
    <p class="max-w-prose text-sm text-text-muted">{editorStep.behaviour}</p>
    <Button
      class="self-start"
      variant="secondary"
      disabled={!readable || launching}
      onclick={openInEditor}
    >
      Open the editor
    </Button>
    {#if !readable}
      <p class="text-sm text-text-muted">
        There is no checked, committed version to open yet.
      </p>
    {/if}
    {#if launchProblem !== null}
      <Alert.Root variant="danger">
        <Alert.Title>The editing session did not open.</Alert.Title>
        <Alert.Description>{launchProblem}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if launch !== null}
      <div class="flex flex-col gap-8">
        <p class="text-sm text-text-muted">
          The session is open with
          <strong>{launch.capability === "edit" ? "editing" : "read-only"}</strong>
          access, until {formatDocumentTimestamp(new Date(launch.accessTokenTtl).toISOString())}.
        </p>
        <a
          class="inline-flex items-center gap-4 text-sm underline underline-offset-2"
          href={launch.editorUrl}
          {...opensBeside("session")}
        >
          <ExternalLink class="size-16" aria-hidden="true" />
          Open the editor in a new tab
        </a>
        <!-- Sized by aspect ratio rather than a height: the spacing scale has no step this tall,
             and an invented one silently resolves to something else entirely. -->
        <iframe
          class="aspect-video w-full rounded-md border border-border-default bg-surface-raised"
          src={launch.editorUrl}
          title="Document editor for {subject.name}"
        ></iframe>
      </div>
    {/if}
  </section>
</div>
