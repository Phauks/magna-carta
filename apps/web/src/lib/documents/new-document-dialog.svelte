<script lang="ts">
  /*
   * The two ways a document arrives on a matter, in one dialog: from a file the person already has,
   * or built from one of the firm's templates. They share a dialog because they answer the same
   * question ("put a document on this matter") and produce the same thing — a document row the list
   * shows a moment later.
   *
   * Neither path invents anything. The upload runs the real four-step ceremony and the template list
   * is the firm's own catalogue, so an empty catalogue shows as empty rather than being padded with
   * examples. The ceremonies themselves live in create-document.ts; this component owns the form,
   * the running state, and how an outcome reads.
   *
   * ONE COMMIT, WHICH PATH IS OPEN DECIDES ITS VERB. The two paths used to carry a button each;
   * the shell's bar holds one, so the commit reads "Add Document" on the file path and "Build
   * Document" on the template path, and refuses with the reason until that path has what it needs.
   *
   * A DOCUMENT THAT LANDED IS A DONE PANEL. Whether it was created, rejected by the scan, or is
   * still being checked, it is on the matter and the list behind has been told — so the panel
   * stays to say which of those happened, with nothing left to ask, and leaves through Close. A
   * request that never reached the server, or a problem the server stated, is a refusal: the
   * panel stands with the reason in the notice band and the form still in hand.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    listTemplates,
    type AssemblyOutputFormat,
    type TemplateSummary,
  } from "./document-api.ts";
  import {
    assembleDocument,
    uploadDocument,
    type CreationOutcome,
    type CreationStage,
  } from "./create-document.ts";
  import { problemGuidance } from "./document-presentation.ts";

  let {
    open = $bindable(false),
    matterId,
    onCreated,
  }: {
    open?: boolean;
    matterId: string;
    /** Called once a document has landed, so the list can re-read. */
    onCreated: (fileId: string) => void;
  } = $props();

  type Path = "file" | "template";
  let path = $state<Path>("file");
  let chosenFile = $state<File | null>(null);
  let templates = $state<readonly TemplateSummary[] | null>(null);
  let templatesFailure = $state<StatedFailure | null>(null);
  let selectedTemplateVersionId = $state("");
  // A word-processing document is the default because it is the one a person can still edit. PDF is
  // the deliberate choice, and it is the only one the platform seal accepts.
  let outputFormat = $state<AssemblyOutputFormat>("docx");
  let stage = $state<CreationStage | null>(null);
  let outcome = $state<CreationOutcome | null>(null);
  let absentFieldKeys = $state<readonly string[]>([]);
  let frozenMergeFieldNames = $state<readonly string[]>([]);
  let producedFormat = $state<AssemblyOutputFormat | null>(null);

  /** Read the firm's catalogue. Retry asks again after a failed read. */
  function readTemplates(): void {
    templates = null;
    templatesFailure = null;
    void (async () => {
      const result = await listTemplates(fetch);
      if (result.kind === "ok") {
        // Only a template with a scanned, current version can be assembled from; one whose bytes
        // have not cleared the gate would fail the submit, so it is not offered.
        templates = result.value.data.filter(
          (template) => template.status === "active" && template.currentVersionId !== null,
        );
      } else {
        templatesFailure = stated(result.failure, "The template catalogue could not be read.");
      }
    })();
  }

  // The catalogue is read when the dialog first opens, not on mount: a matter screen that is never
  // used to create a document should not spend a request on the template list.
  $effect(() => {
    if (!open || templates !== null || templatesFailure !== null) return;
    readTemplates();
  });

  const templateItems = $derived(
    (templates ?? []).map((template) => ({
      value: template.currentVersionId ?? "",
      label: template.name,
    })),
  );

  const OUTPUT_FORMAT_ITEMS: readonly { value: AssemblyOutputFormat; label: string }[] = [
    { value: "docx", label: "Word document, still editable" },
    { value: "pdf", label: "PDF, ready to sign" },
  ];

  /*
   * The shape the template path takes while the catalogue is read: the same two labelled pickers,
   * over invented templates. Inert and hidden from assistive technology while it stands, so
   * nothing in it can be picked or read as one of the firm's own.
   */
  const FIXTURE_TEMPLATE_VALUE = "fixture-engagement";
  const TEMPLATE_FIXTURE_ITEMS = [
    { value: FIXTURE_TEMPLATE_VALUE, label: "Engagement letter" },
    { value: "fixture-retainer", label: "Retainer agreement" },
  ];

  const STAGE_NARRATION: Record<CreationStage, string> = {
    reserving: "Reserving the document…",
    uploading: "Sending the bytes to storage…",
    committing: "Recording the upload…",
    assembling: "Building the document from the template…",
    scanning: "Checking the document…",
    settled: "Finished.",
  };

  function clearOutcome(): void {
    stage = null;
    outcome = null;
    absentFieldKeys = [];
    frozenMergeFieldNames = [];
    producedFormat = null;
  }

  function reset(): void {
    clearOutcome();
    path = "file";
    chosenFile = null;
    selectedTemplateVersionId = "";
    outputFormat = "docx";
  }

  const refusal = $derived.by((): string | undefined => {
    if (path === "file") return chosenFile === null ? "Choose a document first." : undefined;
    if (templatesFailure !== null) return "The template catalogue could not be read.";
    if (templates === null) return "The template catalogue is still being read.";
    if (templates.length === 0) return "This firm has no templates to build from.";
    return selectedTemplateVersionId === "" ? "Choose a template first." : undefined;
  });

  /** A request that reached the server and was answered stands; anything else is a refusal. */
  const landed = $derived(
    outcome !== null &&
      (outcome.kind === "created" || outcome.kind === "rejected" || outcome.kind === "still-settling"),
  );

  async function create(): Promise<ActionOutcome> {
    if (refusal !== undefined) return "refused";
    clearOutcome();
    if (path === "file") {
      if (chosenFile === null) return "refused";
      outcome = await uploadDocument({
        fetchImpl: fetch,
        matterId,
        file: chosenFile,
        onStage: (next) => (stage = next),
      });
    } else {
      const result = await assembleDocument({
        fetchImpl: fetch,
        matterId,
        templateVersionId: selectedTemplateVersionId,
        outputFormat,
        onStage: (next) => (stage = next),
      });
      outcome = result.creation;
      absentFieldKeys = result.absentFieldKeys;
      frozenMergeFieldNames = result.frozenMergeFieldNames;
      producedFormat = result.outputFormat;
    }
    stage = "settled";
    const settled = outcome;
    if (settled === null) return "refused";
    if (settled.kind === "created" || settled.kind === "rejected" || settled.kind === "still-settling") {
      onCreated(settled.fileId);
      return "done";
    }
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Add a Document"
  commitLabel={path === "file" ? "Add Document" : "Build Document"}
  commitBusyLabel={path === "file" ? "Adding" : "Building"}
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={create}
>
  {#snippet fields({ busy, done })}
    {#if done && outcome !== null && landed}
      {#if outcome.kind === "created"}
        <Alert.Root variant="success">
          <Alert.Title>The document is on the matter.</Alert.Title>
          <Alert.Description>
            It is in the list behind this dialog.
            {#if producedFormat === "pdf"}
              It is a PDF, which is the form the platform seal accepts.
            {/if}
          </Alert.Description>
        </Alert.Root>
      {:else if outcome.kind === "rejected"}
        <Alert.Root variant="danger">
          <Alert.Title>The document was rejected.</Alert.Title>
          <Alert.Description>
            {outcome.reason ?? "The scan refused these bytes."} It is listed on the matter so the
            rejection is visible, but it has no readable content.
          </Alert.Description>
        </Alert.Root>
      {:else}
        <Alert.Root variant="info">
          <Alert.Title>The document is still being checked.</Alert.Title>
          <Alert.Description>
            It is on the matter and will show its outcome the next time the list is read.
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if absentFieldKeys.length > 0 || frozenMergeFieldNames.length > 0}
        <Alert.Root variant="warning">
          <Alert.Title>The document has blanks in it.</Alert.Title>
          <Alert.Description>
            {#if absentFieldKeys.length > 0}
              <span class="block">The matter could not supply: {absentFieldKeys.join(", ")}.</span>
            {/if}
            {#if frozenMergeFieldNames.length > 0}
              <span class="block">
                These fields print whatever text was last saved into the template, not a merged
                value: {frozenMergeFieldNames.join(", ")}.
              </span>
            {/if}
          </Alert.Description>
        </Alert.Root>
      {/if}
    {:else}
      <Tabs.Root bind:value={() => path, (next) => (path = next as Path)}>
        <Tabs.List>
          <Tabs.Trigger value="file" disabled={busy}>From a file</Tabs.Trigger>
          <Tabs.Trigger value="template" disabled={busy}>From a template</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="file">
          <div class="flex flex-col gap-12">
            <Dropzone
              label="Choose a document to add"
              prompt="Drag a document here, or use the button"
              disabled={busy}
              onFiles={(files) => {
                chosenFile = files[0] ?? null;
                clearOutcome();
              }}
            />
            {#if chosenFile !== null}
              <p class="text-sm text-text-muted">Ready to add: {chosenFile.name}</p>
            {/if}
          </div>
        </Tabs.Content>

        <Tabs.Content value="template">
          <div class="flex flex-col gap-12">
            <LoadingRegion
              loading={templates === null}
              failed={templatesFailure !== null}
              empty={templates !== null && templates.length === 0}
              label="Reading the firm's templates"
              onRetry={readTemplates}
              class="flex flex-col gap-12"
            >
              {#snippet failure()}
                {#if templatesFailure !== null}
                  <FailureNotice
                    failure={templatesFailure.failure}
                    subject="The template catalogue"
                    fallback={templatesFailure.fallback}
                    onRetry={readTemplates}
                  >
                    Adding a document from a file still works.
                  </FailureNotice>
                {/if}
              {/snippet}
              {#snippet emptyState()}
                <Alert.Root variant="info">
                  <Alert.Title>This firm has no templates yet.</Alert.Title>
                  <Alert.Description>
                    A template is registered once and then assembled against any matter. Until one
                    is registered there is nothing to build from, so this list is genuinely empty
                    rather than showing examples.
                  </Alert.Description>
                </Alert.Root>
              {/snippet}
              {#snippet fixture()}
                <div class="flex flex-col gap-8">
                  <Label>Template</Label>
                  <Select.Root
                    type="single"
                    items={TEMPLATE_FIXTURE_ITEMS}
                    value={FIXTURE_TEMPLATE_VALUE}
                    allowDeselect={false}
                  >
                    <Select.Trigger class="max-w-sm" aria-label="Template">
                      <Select.Value />
                    </Select.Trigger>
                  </Select.Root>
                </div>
                <div class="flex flex-col gap-8">
                  <Label>Build it as</Label>
                  <Select.Root
                    type="single"
                    items={[...OUTPUT_FORMAT_ITEMS]}
                    value="docx"
                    allowDeselect={false}
                  >
                    <Select.Trigger class="max-w-sm" aria-label="Build it as">
                      <Select.Value />
                    </Select.Trigger>
                  </Select.Root>
                  <p class="text-sm text-text-muted">
                    A PDF is converted from the merged document before it is filed, so it takes a
                    little longer. Choose it when the document is going out to be signed.
                  </p>
                </div>
              {/snippet}
              <div class="flex flex-col gap-8">
                <Label id="new-document-template-label">Template</Label>
                <Select.Root
                  type="single"
                  items={templateItems}
                  bind:value={selectedTemplateVersionId}
                  allowDeselect={false}
                  disabled={busy}
                >
                  <Select.Trigger class="max-w-sm" aria-labelledby="new-document-template-label">
                    <Select.Value placeholder="Choose a template" />
                  </Select.Trigger>
                  <Select.Content>
                    {#each templateItems as item (item.value)}
                      <Select.Item value={item.value} label={item.label} />
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="flex flex-col gap-8">
                <Label id="new-document-format-label">Build it as</Label>
                <Select.Root
                  type="single"
                  items={[...OUTPUT_FORMAT_ITEMS]}
                  bind:value={outputFormat}
                  allowDeselect={false}
                  disabled={busy}
                >
                  <Select.Trigger class="max-w-sm" aria-labelledby="new-document-format-label">
                    <Select.Value placeholder="Choose a format" />
                  </Select.Trigger>
                  <Select.Content>
                    {#each OUTPUT_FORMAT_ITEMS as item (item.value)}
                      <Select.Item value={item.value} label={item.label} />
                    {/each}
                  </Select.Content>
                </Select.Root>
                <p class="text-sm text-text-muted">
                  A PDF is converted from the merged document before it is filed, so it takes a
                  little longer. Choose it when the document is going out to be signed.
                </p>
              </div>
            </LoadingRegion>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {#if stage !== null}
        <p class="text-sm text-text-muted" role="status" aria-live="polite">
          {STAGE_NARRATION[stage]}
        </p>
      {/if}
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if outcome !== null && !landed}
      {#if outcome.kind === "transport"}
        <Alert.Root variant="danger">
          <Alert.Title>Couldn't connect.</Alert.Title>
          <Alert.Description>
            The request did not reach the server. Check the connection and try again.
          </Alert.Description>
        </Alert.Root>
      {:else if outcome.kind === "problem"}
        {@const guidance = problemGuidance(outcome.problem)}
        <Alert.Root variant={guidance.tone === "info" ? "info" : guidance.tone}>
          <Alert.Title>{guidance.title}</Alert.Title>
          <Alert.Description>
            {guidance.message}
            {#if outcome.problem.errorId}
              <span class="block">Error ID: {outcome.problem.errorId}</span>
            {/if}
          </Alert.Description>
        </Alert.Root>
      {/if}
    {/if}
  {/snippet}
</ActionDialog>
