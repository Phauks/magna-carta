<script lang="ts">
  /*
   * Registering a template — the panel the firm's catalogue grows through.
   *
   * THE KIND IS READ OFF THE FILE, NEVER PICKED. A .docx registers as a Word template and a .pdf as
   * a fillable form, because the signed upload URL covers the content type and a person asked to
   * say "Word or PDF" beside a file that already says it can only get it wrong. The line under the
   * chosen file states which it will register as, so nothing is decided out of sight.
   *
   * NEITHER TRANSFORM OF THE FIRM'S OWN DOCUMENT RUNS UNASKED. Macro removal is on by default,
   * because a document carrying macros is refused outright without it; Word merge-field conversion
   * is off by default, because it rewrites the document. Each box carries its consequence in place,
   * in the reader's words, because a setting whose whole meaning lives on a hover has no meaning on
   * a touch device.
   *
   * ONE KEY PER INTENT, KEPT ACROSS RETRIES. The idempotency key is minted when the panel opens and
   * rotates only once a registration has succeeded, so a retry after a timeout replays the same
   * request rather than registering the template twice ($lib/api/write-intent.ts says why). It is
   * held here rather than in WriteIntent because the ceremony reports a failure as a value rather
   * than a rejection, and the intent's own rotation would not know the difference.
   *
   * A REGISTERED TEMPLATE IS A DONE PANEL. Registration is where the server does its expensive work
   * and answers with a report — what it found, what it changed, what it could not bind — so the
   * panel stays to say all of that, with nothing left to ask, and leaves through Close.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import type { LocationSummary, MatterType, RegisteredTemplate } from "@magna-carta/api-client";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { ANY_MATTER_TYPE, EVERY_OFFICE } from "./template-columns.ts";
  import {
    fieldCountSentence,
    liveRegisterTemplatePorts,
    registerTemplate,
    registrationFindings,
    templateKindForFile,
    templateKindSentence,
    TEMPLATE_FILE_ACCEPT,
    type RegisterOutcome,
    type RegisterStage,
    type TemplateKind,
  } from "./register-template.ts";

  let {
    open = $bindable(false),
    matterTypes,
    locations,
    onRegistered,
  }: {
    open?: boolean;
    /** The firm's practice areas, for the optional binding. */
    matterTypes: readonly MatterType[];
    /** The firm's offices, for the optional binding. */
    locations: readonly LocationSummary[];
    /** Called once a template is in the catalogue, so the listing behind can be read again. */
    onRegistered: (report: RegisteredTemplate) => void;
  } = $props();

  const identity = $props.id();

  /** The value the two optional bindings hold when nothing is chosen: offered to every matter. */
  const UNBOUND = "";

  let chosenFile = $state<File | null>(null);
  let kind = $state<TemplateKind | null>(null);
  let name = $state("");
  /** What the name was last prefilled with, so a name the person typed is never overwritten. */
  let prefilledName = "";
  let description = $state("");
  let matterTypeId = $state(UNBOUND);
  let locationId = $state(UNBOUND);
  let stripMacros = $state(true);
  let convertMergeFields = $state(false);
  let stage = $state<RegisterStage | null>(null);
  let outcome = $state<RegisterOutcome | null>(null);
  let idempotencyKey = crypto.randomUUID();

  const matterTypeOptions = $derived<readonly ChoiceOption[]>([
    { value: UNBOUND, label: ANY_MATTER_TYPE },
    ...matterTypes.map((type) => ({ value: type.id, label: type.name })),
  ]);
  const locationOptions = $derived<readonly ChoiceOption[]>([
    { value: UNBOUND, label: EVERY_OFFICE },
    ...locations.map((location) => ({ value: location.id, label: location.name })),
  ]);

  const STAGE_NARRATION: Record<RegisterStage, string> = {
    reserving: "Reserving a slot…",
    uploading: "Sending the document to storage…",
    registering: "Registering the template…",
    settled: "Registered.",
  };

  function reset(): void {
    chosenFile = null;
    kind = null;
    name = "";
    prefilledName = "";
    description = "";
    matterTypeId = UNBOUND;
    locationId = UNBOUND;
    stripMacros = true;
    convertMergeFields = false;
    stage = null;
    outcome = null;
    idempotencyKey = crypto.randomUUID();
  }

  function choose(files: File[]): void {
    const file = files[0] ?? null;
    chosenFile = file;
    kind = file === null ? null : templateKindForFile(file);
    outcome = null;
    if (file === null) return;
    // The name is offered from the file, and only into a field the person has not written in.
    if (name === "" || name === prefilledName) {
      prefilledName = file.name.replace(/\.[^.]+$/u, "");
      name = prefilledName;
    }
  }

  const refusal = $derived.by((): string | undefined => {
    if (chosenFile === null) return "Choose a document first.";
    if (kind === null) return "Choose a Word document (.docx) or a fillable PDF.";
    if (name.trim() === "") return "Name the template.";
    return undefined;
  });

  const unsavedChanges = $derived(
    chosenFile !== null || name !== "" || description !== "",
  );

  async function register(): Promise<ActionOutcome> {
    if (refusal !== undefined || chosenFile === null || kind === null) return "refused";
    outcome = null;
    const result = await registerTemplate(
      {
        file: chosenFile,
        kind,
        name,
        description,
        matterTypeId: matterTypeId === UNBOUND ? null : matterTypeId,
        locationId: locationId === UNBOUND ? null : locationId,
        convertMergeFields,
        stripMacros,
      },
      {
        ports: liveRegisterTemplatePorts(),
        idempotencyKey,
        onStage: (next) => (stage = next),
      },
    );
    outcome = result;
    if (result.kind === "registered") {
      // Only a success rotates the key: the next thing registered is a new intent.
      idempotencyKey = crypto.randomUUID();
      onRegistered(result.report);
      return "done";
    }
    stage = null;
    return "refused";
  }

  /** What the failed stage did not do, in this panel's own words, where the server sent none. */
  function failureWords(failed: RegisterStage): { fallback: string; whenSilent: string } {
    switch (failed) {
      case "reserving":
        return {
          fallback: "A slot for the document was not reserved, so nothing was registered.",
          whenSilent: "Couldn't connect. Nothing was saved.",
        };
      case "uploading":
        return {
          fallback: "The document did not reach storage, so nothing was registered.",
          whenSilent: "Couldn't reach storage. Nothing was saved.",
        };
      default:
        return {
          fallback: "The template was not registered.",
          whenSilent: "Couldn't connect. The template wasn't saved.",
        };
    }
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Template"
  commitLabel="Register Template"
  commitBusyLabel="Registering"
  commitRefusal={refusal}
  {unsavedChanges}
  onOpen={reset}
  onCommit={register}
>
  {#snippet fields({ busy, done })}
    {#if done && outcome !== null && outcome.kind === "registered"}
      {@const report = outcome.report}
      <div class="flex flex-col gap-12">
        <Alert.Root variant="success">
          <Alert.Title>The Template Is in the Catalogue</Alert.Title>
          <Alert.Description>{fieldCountSentence(report)}</Alert.Description>
        </Alert.Root>
        {#each registrationFindings(report) as finding, index (index)}
          <Alert.Root variant={finding.tone}>
            <Alert.Description>{finding.text}</Alert.Description>
          </Alert.Root>
        {/each}
      </div>
    {:else}
      <div class="flex flex-col gap-16">
        <div class="flex flex-col gap-8">
          <Dropzone
            label="Choose the document to register"
            prompt="Drag a Word document or a fillable PDF here, or use the button"
            accept={TEMPLATE_FILE_ACCEPT}
            disabled={busy}
            onFiles={choose}
          />
          {#if chosenFile !== null}
            <!-- The file, and the kind it registers as: decided from the name, stated rather
                 than asked. A file that is neither is refused at the commit, in words. -->
            <p class="text-sm">
              <span>{chosenFile.name}</span>
              {#if kind !== null}
                <span class="text-text-muted">· {templateKindSentence(kind)}</span>
              {/if}
            </p>
          {/if}
        </div>

        <LabelledField label="Name" id="{identity}-name">
          {#snippet children({ props })}
            <Input {...props} required disabled={busy} bind:value={name} />
          {/snippet}
        </LabelledField>

        <LabelledField label="Description" id="{identity}-description">
          {#snippet children({ props })}
            <Textarea {...props} rows={2} resizable={false} disabled={busy} bind:value={description} />
          {/snippet}
        </LabelledField>

        <div class="grid gap-12 @sm:grid-cols-2">
          <LabelledField label="Practice Area" id="{identity}-matter-type">
            {#snippet children({ props })}
              <ChoicePicker
                inputId={props.id}
                label="Practice Area"
                options={matterTypeOptions}
                disabled={busy}
                bind:value={matterTypeId}
              />
            {/snippet}
          </LabelledField>

          <LabelledField label="Office" id="{identity}-location">
            {#snippet children({ props })}
              <ChoicePicker
                inputId={props.id}
                label="Office"
                options={locationOptions}
                disabled={busy}
                bind:value={locationId}
              />
            {/snippet}
          </LabelledField>
        </div>

        <div class="flex flex-col gap-12">
          <div class="flex items-start gap-8">
            <Checkbox id="{identity}-strip-macros" disabled={busy} bind:checked={stripMacros} />
            <div class="flex flex-col gap-4">
              <Label for="{identity}-strip-macros">Remove macro content</Label>
              <p class="text-xs text-text-muted">
                A document carrying macros is refused unless this is on. With it on, the registered
                document is not the one uploaded.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-8">
            <Checkbox
              id="{identity}-convert-merge-fields"
              disabled={busy}
              bind:checked={convertMergeFields}
            />
            <div class="flex flex-col gap-4">
              <Label for="{identity}-convert-merge-fields">Convert Word merge fields</Label>
              <p class="text-xs text-text-muted">
                If left off, the document is saved exactly as written, and any Word merge fields print their last saved text instead of a merged value.
              </p>
            </div>
          </div>
        </div>

        {#if stage !== null}
          <p class="text-sm text-text-muted" role="status" aria-live="polite">
            {STAGE_NARRATION[stage]}
          </p>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if outcome !== null && outcome.kind === "failed"}
      {@const words = failureWords(outcome.stage)}
      <FailureNotice
        failure={outcome.failure}
        title="Nothing Was Registered"
        fallback={words.fallback}
        whenSilent={words.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>
