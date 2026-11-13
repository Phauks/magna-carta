<script lang="ts">
  /*
   * Settings · Intake Procedures — what a kind of matter must clear before it opens, as the firm's
   * own list.
   *
   * A procedure GATES: a consultation of its kind does not open while a required step is
   * unanswered. That is the whole difference from a matter plan, which offers work after the
   * opening, and this screen says so, because somebody authoring "Send the engagement letter"
   * reasonably wants to know whether the platform will hold the door.
   *
   * WHO ANSWERS A STEP IS THE KIND'S TO DECIDE, and the kind picker says it beside each choice: a
   * conflicts-check step is answered by the matter's conflicts record and cannot be recorded by
   * hand; an identity-verification step is a member's word until the platform can see it. A
   * procedure edit reaches every open consultation of that kind at once, because a checklist is
   * derived at the moment it is read; records already made are untouched.
   *
   * The platform ships no procedures. This list starts empty in every firm, on purpose.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE } from "@magna-carta/design-system/loading-fixtures";
  import Textarea from "@magna-carta/design-system/textarea";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    addIntakeProcedureStep,
    createIntakeProcedure,
    listIntakeProcedures,
    readIntakeProcedure,
    retireIntakeProcedureStep,
    setIntakeProcedureActive,
    MANAGE_INTAKE_PROCEDURES_PERMISSION,
    type IntakeProcedure,
    type IntakeStepKind,
  } from "$lib/intake/intake-api.ts";
  import {
    INTAKE_STEP_KIND_VOCABULARY,
    intakeStepKindLabel,
    intakeStepKindVocabulary,
  } from "$lib/intake/intake-procedure.ts";
  import { listTemplates, type TemplateSummary } from "$lib/documents/document-api.ts";
  import {
    listMatterTypes,
    readSession,
    type MatterTypeSummary,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";
  import { newWriteKey } from "$lib/matters/tasks-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  let procedures = $state<readonly IntakeProcedure[] | null>(null);
  let matterTypes = $state<readonly MatterTypeSummary[]>([]);
  let templates = $state<readonly TemplateSummary[]>([]);
  let openProcedure = $state<IntakeProcedure | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  let saving = $state(false);
  /** True while a list already on screen is being read again after a write. */
  let rereading = $state(false);

  // Authoring is its own permission: what the firm requires, rather than answering it. A member
  // without it reads the firm's procedures and changes none, so the controls are absent rather than
  // present-and-refusing.
  const canManage = $derived(
    session === null || session.permissions.includes(MANAGE_INTAKE_PROCEDURES_PERMISSION),
  );

  let composing = $state(false);
  let draftName = $state("");
  let draftDescription = $state("");
  /** "" binds the procedure to every kind of matter. */
  // A procedure bound to no kind holds this sentinel rather than an empty string: the choice field
  // offers "every kind" as a real option, and a real option carries a value of its own.
  const EVERY_KIND = "every-kind";
  let draftMatterTypeId = $state(EVERY_KIND);

  let composingStep = $state(false);
  let stepKind = $state<IntakeStepKind>("acknowledgement");
  let stepTitle = $state("");
  let stepInstructions = $state("");
  let stepRequired = $state(true);
  let stepReference = $state("");

  const stepVocabulary = $derived(intakeStepKindVocabulary(stepKind));
  const matterTypeChoices = $derived([
    { value: EVERY_KIND, label: "All matter types" },
    ...matterTypes.filter((type) => type.active).map((type) => ({ value: type.id, label: type.name })),
  ]);
  const stepKindChoices = INTAKE_STEP_KIND_VOCABULARY.map((entry) => ({
    value: entry.kind,
    label: entry.label,
  }));

  $effect(() => {
    void readSession(fetch).then((outcome) => {
      session = outcome.kind === "ok" ? outcome.value : null;
    });
    void listMatterTypes(fetch).then((outcome) => {
      matterTypes = outcome.kind === "ok" ? outcome.value.data : [];
    });
    void listTemplates(fetch).then((outcome) => {
      templates = outcome.kind === "ok" ? outcome.value.data : [];
    });
    void refresh();
  });

  async function refresh(): Promise<void> {
    rereading = procedures !== null;
    const outcome = await listIntakeProcedures(fetch, true);
    rereading = false;
    if (outcome.kind !== "ok") {
      // The rows already on screen were read and stand; a failed first read leaves nothing, and
      // the region renders the notice in place of the shape.
      readFailure = stated(outcome.failure, "The firm's intake procedures could not be read.");
      return;
    }
    readFailure = null;
    procedures = outcome.value.data;
    const current = openProcedure;
    if (current !== null) await openDetail(current.id);
  }

  async function openDetail(procedureId: string): Promise<void> {
    const outcome = await readIntakeProcedure(fetch, procedureId);
    openProcedure = outcome.kind === "ok" ? outcome.value : null;
    if (outcome.kind !== "ok") {
      writeFailure = stated(outcome.failure, "That procedure could not be read.");
    }
  }

  async function runWrite(
    call: () => Promise<{ kind: string } & Record<string, unknown>>,
    whenSilent: string,
    after?: () => void,
  ): Promise<void> {
    if (saving) return;
    saving = true;
    writeFailure = null;
    const outcome = (await call()) as
      | { kind: "ok" }
      | { kind: "transport" | "problem"; failure: Parameters<typeof stated>[0] };
    saving = false;
    if (outcome.kind === "ok") {
      after?.();
      await refresh();
      return;
    }
    writeFailure = stated(outcome.failure, whenSilent);
  }

  function matterTypeName(matterTypeId: string | null): string {
    if (matterTypeId === null) return "All matter types";
    return matterTypes.find((type) => type.id === matterTypeId)?.name ?? "A matter type";
  }

  function templateName(templateId: string): string {
    return templates.find((template) => template.templateId === templateId)?.name ?? templateId;
  }

  function chooseKind(chosen: string): void {
    const entry = INTAKE_STEP_KIND_VOCABULARY.find((candidate) => candidate.kind === chosen);
    if (entry !== undefined) {
      stepKind = entry.kind;
      stepReference = "";
    }
  }

  // "No template" is a real choice, so the field offers it as a row of its own; the reference the
  // step stores for it stays the empty string the contract expects.
  const NO_TEMPLATE = "no-template";
  const templateChoices = $derived([
    { value: NO_TEMPLATE, label: "No template" },
    ...templates.map((template) => ({ value: template.templateId, label: template.name })),
  ]);

  // The shape drawn while the list is read: two procedures in the list's own row, sample words only.
  // The description is the sample vocabulary's sentence; a procedure's name and the kind it binds
  // are the firm's own kind of words, which it does not carry.
  const PROCEDURE_FIXTURE = [
    { name: "New client, litigation", binds: "All matter types", description: SAMPLE_SENTENCE },
    { name: "Estate planning engagement", binds: "Estate planning", description: SAMPLE_SENTENCE },
  ];
</script>

<svelte:head>
  <title>Intake Procedures · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="intake-procedures"
  title="Intake Procedures"
  posture={canManage ? "draft" : "readOnly"}
/>

<SettingsScrollRegion>
  <SettingsDescription>What a kind of matter must clear before it opens, as a list the firm writes for itself.</SettingsDescription>

    <Alert.Root variant="info">
      <Alert.Title>A Procedure Holds The Door</Alert.Title>
      <Alert.Description>
        A consultation can't open while a required step is unanswered. Each step is answered by its source: the conflicts check, the fee agreement, a document on the matter, the trust ledger, or a staff member confirming it was done. Staff with permission can waive a step, with a reason under their name.
      </Alert.Description>
    </Alert.Root>

    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure.failure}
        title="Nothing Changed"
        fallback={writeFailure.fallback}
      />
    {/if}

    <div class="flex items-center justify-between gap-16 border-b border-border-strong pb-8">
      <FieldLabel as="h2">The Firm's Procedures</FieldLabel>
      {#if composing}
        <Button variant="secondary" disabled={saving} onclick={() => (composing = false)}>Cancel</Button>
      {:else}
        <Button variant="secondary" disabled={!canManage} onclick={() => (composing = true)}>
          <Plus aria-hidden="true" />
          New Procedure
        </Button>
      {/if}
    </div>

    {#if composing}
      <div class="flex flex-col gap-12 rounded-md border border-border-strong p-16">
        <div class="flex flex-col gap-4">
          <Label for="procedure-name">Name</Label>
          <Input id="procedure-name" bind:value={draftName} disabled={saving} />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="procedure-description">What this procedure is for</Label>
          <Textarea
            id="procedure-description"
            bind:value={draftDescription}
            rows={2}
            disabled={saving}
          />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="procedure-matter-type">Binds</Label>
          <div class="w-xs">
            <ChoicePicker
              options={matterTypeChoices}
              inputId="procedure-matter-type"
              label="Binds"
              disabled={saving}
              bind:value={draftMatterTypeId}
            />
          </div>
          <p class="text-xs text-text-muted">
            A consultation is bound by the procedures for its kind and by every procedure bound to
            no kind.
          </p>
        </div>
        <div class="flex justify-end">
          <Button
            disabled={saving || draftName.trim().length === 0}
            onclick={() =>
              runWrite(
                () =>
                  createIntakeProcedure(
                    fetch,
                    {
                      name: draftName.trim(),
                      description: draftDescription.trim() === "" ? null : draftDescription.trim(),
                      matterTypeId: draftMatterTypeId === EVERY_KIND ? null : draftMatterTypeId,
                    },
                    newWriteKey(),
                  ),
                "The procedure was not created.",
                () => {
                  composing = false;
                  draftName = "";
                  draftDescription = "";
                  draftMatterTypeId = EVERY_KIND;
                },
              )}
          >
            Create Procedure
          </Button>
        </div>
      </div>
    {/if}

    <!-- A failed first read settles to the notice with Retry; a failed re-read after a write keeps
         the rows on screen and says so above them. -->
    <LoadingRegion
      loading={procedures === null}
      failed={readFailure !== null && procedures === null}
      refreshing={rereading}
      empty={procedures !== null && procedures.length === 0}
      label="Reading the firm's intake procedures"
      onRetry={() => void refresh()}
      class="flex flex-col"
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure.failure}
            title="Procedures Unavailable"
            fallback={readFailure.fallback}
            onRetry={() => void refresh()}
          />
        {/if}
      {/snippet}
      {#snippet emptyState()}
        <EmptyState title="No procedures yet">
          A procedure lists what a type of matter needs before you take it on, such as a conflicts check, fee agreement, engagement letter, retainer or client questions. Every consultation of that type must complete it.
        </EmptyState>
      {/snippet}
      {#snippet fixture()}
        <ul class="flex flex-col gap-8">
          {#each PROCEDURE_FIXTURE as procedure (procedure.name)}
            <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
              <div class="flex flex-wrap items-start justify-between gap-8">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-8">
                    <span>{procedure.name}</span>
                    <Badge variant="neutral">{procedure.binds}</Badge>
                  </div>
                  <p class="text-xs text-text-muted">{procedure.description}</p>
                </div>
                <div class="flex gap-4">
                  <Button variant="secondary">Steps</Button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/snippet}
      {@const shown = procedures ?? []}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="The Procedures Were Not Re-read"
          fallback={readFailure.fallback}
          onRetry={() => void refresh()}
        />
      {/if}
      {#if shown.length > 0}
        <ul class="flex flex-col gap-8">
          {#each shown as procedure (procedure.id)}
            <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
              <div class="flex flex-wrap items-start justify-between gap-8">
                <div class="flex flex-col gap-2">
                  <div class="flex items-center gap-8">
                    <span class={procedure.active ? "" : "text-text-muted"}>{procedure.name}</span>
                    <Badge variant="neutral">{matterTypeName(procedure.matterTypeId)}</Badge>
                    {#if !procedure.active}
                      <Badge variant="neutral">Not in force</Badge>
                    {/if}
                  </div>
                  {#if procedure.description !== null}
                    <p class="text-xs text-text-muted">{procedure.description}</p>
                  {/if}
                </div>
                <div class="flex gap-4">
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onclick={() =>
                      openProcedure?.id === procedure.id
                        ? (openProcedure = null)
                        : openDetail(procedure.id)}
                  >
                    {openProcedure?.id === procedure.id ? "Close" : "Steps"}
                  </Button>
                  {#if canManage}
                    <Button
                      variant="ghost"
                      disabled={saving}
                      title={procedure.active
                        ? "Stop holding consultations to this procedure"
                        : "Hold consultations to this procedure again"}
                      onclick={() =>
                        runWrite(
                          () =>
                            setIntakeProcedureActive(
                              fetch,
                              procedure.id,
                              !procedure.active,
                              newWriteKey(),
                            ),
                          "The procedure's standing was not changed.",
                        )}
                    >
                      {procedure.active ? "Stop Requiring" : "Require Again"}
                    </Button>
                  {/if}
                </div>
              </div>

              {#if openProcedure?.id === procedure.id}
                <div class="flex flex-col gap-8 border-t border-border-subtle pt-8">
                  {#if (openProcedure.steps ?? []).length === 0}
                    <p class="text-xs text-text-muted">
                      This procedure has no steps yet, so it asks for nothing.
                    </p>
                  {:else}
                    <ul class="flex flex-col gap-4">
                      {#each openProcedure.steps ?? [] as step (step.id)}
                        <li class="flex flex-wrap items-center justify-between gap-8 text-xs">
                          <div class="flex flex-wrap items-center gap-8">
                            <span class="text-text">{step.title}</span>
                            <Badge variant="neutral">{intakeStepKindLabel(step.kind)}</Badge>
                            {#if !step.required}
                              <span class="text-text-muted">Optional</span>
                            {/if}
                            {#if step.referenceId !== null}
                              <span class="text-text-muted">
                                {intakeStepKindVocabulary(step.kind).reference?.label === "Template"
                                  ? templateName(step.referenceId)
                                  : step.referenceId}
                              </span>
                            {/if}
                          </div>
                          {#if canManage}
                            <Button
                              variant="ghost"
                              disabled={saving}
                              title="Retire this step. It won't be asked again; past answers are kept."
                              onclick={() =>
                                runWrite(
                                  () => retireIntakeProcedureStep(fetch, step.id, newWriteKey()),
                                  "The step was not retired.",
                                )}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}

                  {#if canManage}
                    {#if composingStep}
                      <div class="flex flex-col gap-8 rounded-md border border-border-subtle p-12">
                        <div class="flex flex-wrap items-end gap-16">
                          <div class="flex flex-col gap-4">
                            <Label for="step-kind">Kind</Label>
                            <div class="w-xs">
                              <ChoicePicker
                                options={stepKindChoices}
                                inputId="step-kind"
                                label="Kind"
                                disabled={saving}
                                bind:value={() => stepKind, chooseKind}
                              />
                            </div>
                          </div>
                          <div class="flex items-center gap-8 pb-8">
                            <Checkbox id="step-required" bind:checked={stepRequired} disabled={saving} />
                            <Label for="step-required">Required before the matter opens</Label>
                          </div>
                        </div>
                        <p class="text-xs text-text-muted">
                          {stepVocabulary.description} {stepVocabulary.answeredBy}
                        </p>
                        <div class="flex flex-col gap-4">
                          <Label for="step-title">What to do</Label>
                          <Input id="step-title" bind:value={stepTitle} disabled={saving} />
                        </div>
                        <div class="flex flex-col gap-4">
                          <Label for="step-instructions">Instructions</Label>
                          <Textarea
                            id="step-instructions"
                            bind:value={stepInstructions}
                            rows={2}
                            disabled={saving}
                          />
                        </div>
                        {#if stepVocabulary.reference !== null}
                          <div class="flex flex-col gap-4">
                            <Label for="step-reference">{stepVocabulary.reference.label}</Label>
                            {#if stepVocabulary.reference.label === "Template"}
                              <div class="w-xs">
                                <ChoicePicker
                                  options={templateChoices}
                                  inputId="step-reference"
                                  label={stepVocabulary.reference.label}
                                  disabled={saving}
                                  bind:value={
                                    () => (stepReference === "" ? NO_TEMPLATE : stepReference),
                                    (next) => (stepReference = next === NO_TEMPLATE ? "" : next)
                                  }
                                />
                              </div>
                            {:else}
                              <Input
                                id="step-reference"
                                bind:value={stepReference}
                                disabled={saving}
                                class="w-xs"
                              />
                            {/if}
                            <p class="text-xs text-text-muted">{stepVocabulary.reference.hint}</p>
                          </div>
                        {/if}
                        <div class="flex justify-end gap-8">
                          <Button
                            variant="secondary"
                            disabled={saving}
                            onclick={() => (composingStep = false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            disabled={saving || stepTitle.trim().length === 0}
                            onclick={() =>
                              runWrite(
                                () =>
                                  addIntakeProcedureStep(
                                    fetch,
                                    procedure.id,
                                    {
                                      kind: stepKind,
                                      title: stepTitle.trim(),
                                      instructions:
                                        stepInstructions.trim() === ""
                                          ? null
                                          : stepInstructions.trim(),
                                      required: stepRequired,
                                      referenceId:
                                        stepReference.trim() === "" ? null : stepReference.trim(),
                                      position: (openProcedure?.steps ?? []).length,
                                    },
                                    newWriteKey(),
                                  ),
                                "The step was not added.",
                                () => {
                                  composingStep = false;
                                  stepTitle = "";
                                  stepInstructions = "";
                                  stepReference = "";
                                  stepRequired = true;
                                  stepKind = "acknowledgement";
                                },
                              )}
                          >
                            Add Step
                          </Button>
                        </div>
                      </div>
                    {:else}
                      <div class="flex justify-end">
                        <Button variant="ghost" disabled={saving} onclick={() => (composingStep = true)}>
                          <Plus aria-hidden="true" />
                          Add Step
                        </Button>
                      </div>
                    {/if}
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </LoadingRegion>
</SettingsScrollRegion>
