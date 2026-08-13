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
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Button from "@magna-carta/design-system/button";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
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

  let chosenFile = $state<File | null>(null);
  let templates = $state<readonly TemplateSummary[] | null>(null);
  let templatesFailed = $state(false);
  let selectedTemplateVersionId = $state("");
  // A word-processing document is the default because it is the one a person can still edit. PDF is
  // the deliberate choice, and it is the only one the platform seal accepts.
  let outputFormat = $state<AssemblyOutputFormat>("docx");
  let stage = $state<CreationStage | null>(null);
  let outcome = $state<CreationOutcome | null>(null);
  let absentFieldKeys = $state<readonly string[]>([]);
  let frozenMergeFieldNames = $state<readonly string[]>([]);
  let producedFormat = $state<AssemblyOutputFormat | null>(null);

  const running = $derived(stage !== null && stage !== "settled");

  // The catalogue is read when the dialog first opens, not on mount: a matter screen that is never
  // used to create a document should not spend a request on the template list.
  $effect(() => {
    if (!open || templates !== null || templatesFailed) return;
    let cancelled = false;
    void (async () => {
      const result = await listTemplates(fetch);
      if (cancelled) return;
      if (result.kind === "ok") {
        // Only a template with a scanned, current version can be assembled from; one whose bytes
        // have not cleared the gate would fail the submit, so it is not offered.
        templates = result.value.data.filter(
          (template) => template.status === "active" && template.currentVersionId !== null,
        );
      } else {
        templatesFailed = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const templateItems = $derived(
    (templates ?? []).map((template) => ({
      value: template.currentVersionId ?? "",
      label: template.name,
    })),
  );

  const OUTPUT_FORMAT_ITEMS: readonly { value: AssemblyOutputFormat; label: string }[] = [
    { value: "docx", label: "Word document — still editable" },
    { value: "pdf", label: "PDF — ready to sign" },
  ];

  const STAGE_NARRATION: Record<CreationStage, string> = {
    reserving: "Reserving the document…",
    uploading: "Sending the bytes to storage…",
    committing: "Recording the upload…",
    assembling: "Building the document from the template…",
    scanning: "Checking the document…",
    settled: "Finished.",
  };

  function reset(): void {
    stage = null;
    outcome = null;
    absentFieldKeys = [];
    frozenMergeFieldNames = [];
    producedFormat = null;
  }

  async function runUpload(): Promise<void> {
    if (chosenFile === null) return;
    reset();
    outcome = await uploadDocument({
      fetchImpl: fetch,
      matterId,
      file: chosenFile,
      onStage: (next) => (stage = next),
    });
    settle();
  }

  async function runAssembly(): Promise<void> {
    if (selectedTemplateVersionId === "") return;
    reset();
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
    settle();
  }

  function settle(): void {
    stage = "settled";
    const settled = outcome;
    if (settled === null) return;
    if (settled.kind === "created" || settled.kind === "rejected" || settled.kind === "still-settling") {
      onCreated(settled.fileId);
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Title>Add a document</Dialog.Title>
    <Dialog.Description>
      Bring a document onto this matter, either from a file you have or from one of the firm's
      templates.
    </Dialog.Description>

    <Tabs.Root value="file">
      <Tabs.List>
        <Tabs.Trigger value="file">From a file</Tabs.Trigger>
        <Tabs.Trigger value="template">From a template</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="file">
        <div class="flex flex-col gap-12">
          <Dropzone
            label="Choose a document to add"
            prompt="Drag a document here, or use the button"
            disabled={running}
            onFiles={(files) => {
              chosenFile = files[0] ?? null;
              reset();
            }}
          />
          {#if chosenFile !== null}
            <p class="text-sm text-text-muted">Ready to add: {chosenFile.name}</p>
          {/if}
          <Button
            class="self-start"
            disabled={chosenFile === null || running}
            onclick={runUpload}
          >
            Add document
          </Button>
        </div>
      </Tabs.Content>

      <Tabs.Content value="template">
        <div class="flex flex-col gap-12">
          {#if templatesFailed}
            <Alert.Root variant="warning">
              <Alert.Title>The template catalogue could not be read.</Alert.Title>
              <Alert.Description>
                Adding a document from a file still works. Reopen this dialog to try again.
              </Alert.Description>
            </Alert.Root>
          {:else if templates === null}
            <Skeleton class="h-32 w-full" />
          {:else if templates.length === 0}
            <Alert.Root variant="info">
              <Alert.Title>This firm has no templates yet.</Alert.Title>
              <Alert.Description>
                A template is registered once and then assembled against any matter. Until one is
                registered there is nothing to build from, so this list is genuinely empty rather
                than showing examples.
              </Alert.Description>
            </Alert.Root>
          {:else}
            <div class="flex flex-col gap-8">
              <Label id="new-document-template-label">Template</Label>
              <Select.Root
                type="single"
                items={templateItems}
                bind:value={selectedTemplateVersionId}
                allowDeselect={false}
                disabled={running}
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
                disabled={running}
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
                A PDF is converted from the merged document before it is filed, so it takes a little
                longer. Choose it when the document is going out to be signed.
              </p>
            </div>
            <Button
              class="self-start"
              disabled={selectedTemplateVersionId === "" || running}
              onclick={runAssembly}
            >
              Build document
            </Button>
          {/if}
        </div>
      </Tabs.Content>
    </Tabs.Root>

    {#if stage !== null}
      <p class="text-sm text-text-muted" role="status" aria-live="polite">
        {STAGE_NARRATION[stage]}
      </p>
    {/if}

    {#if outcome !== null}
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
      {:else if outcome.kind === "still-settling"}
        <Alert.Root variant="info">
          <Alert.Title>The document is still being checked.</Alert.Title>
          <Alert.Description>
            It is on the matter and will show its outcome the next time the list is read.
          </Alert.Description>
        </Alert.Root>
      {:else if outcome.kind === "transport"}
        <Alert.Root variant="danger">
          <Alert.Title>Nothing answered.</Alert.Title>
          <Alert.Description>
            The request did not reach the server. Check the connection and try again.
          </Alert.Description>
        </Alert.Root>
      {:else}
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

    {#if absentFieldKeys.length > 0 || frozenMergeFieldNames.length > 0}
      <Alert.Root variant="warning">
        <Alert.Title>The document has blanks in it.</Alert.Title>
        <Alert.Description>
          {#if absentFieldKeys.length > 0}
            <span class="block">
              The matter could not supply: {absentFieldKeys.join(", ")}.
            </span>
          {/if}
          {#if frozenMergeFieldNames.length > 0}
            <span class="block">
              These fields print whatever text was last saved into the template, not a merged value:
              {frozenMergeFieldNames.join(", ")}.
            </span>
          {/if}
        </Alert.Description>
      </Alert.Root>
    {/if}
  </Dialog.Content>
</Dialog.Root>
