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
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Textarea from "@magna-carta/design-system/textarea";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
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
  let draftMatterTypeId = $state("");

  let composingStep = $state(false);
  let stepKind = $state<IntakeStepKind>("acknowledgement");
  let stepTitle = $state("");
  let stepInstructions = $state("");
  let stepRequired = $state(true);
  let stepReference = $state("");

  const stepVocabulary = $derived(intakeStepKindVocabulary(stepKind));
  const EVERY_KIND = "";

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
    const outcome = await listIntakeProcedures(fetch, true);
    if (outcome.kind !== "ok") {
      readFailure = stated(outcome.failure, "The firm's intake procedures could not be read.");
      procedures = [];
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
    if (matterTypeId === null) return "Every kind of matter";
    return matterTypes.find((type) => type.id === matterTypeId)?.name ?? "A matter type";
  }

  function templateName(templateId: string): string {
    return templates.find((template) => template.templateId === templateId)?.name ?? templateId;
  }

  function chooseKind(next: string | string[] | undefined): void {
    const chosen = Array.isArray(next) ? (next[0] ?? "") : (next ?? "");
    const entry = INTAKE_STEP_KIND_VOCABULARY.find((candidate) => candidate.kind === chosen);
    if (entry !== undefined) {
      stepKind = entry.kind;
      stepReference = "";
    }
  }

  function chooseMatterType(next: string | string[] | undefined): void {
    draftMatterTypeId = Array.isArray(next) ? (next[0] ?? "") : (next ?? "");
  }

  function chooseReference(next: string | string[] | undefined): void {
    stepReference = Array.isArray(next) ? (next[0] ?? "") : (next ?? "");
  }
</script>

<svelte:head>
  <title>Intake Procedures · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="intake-procedures"
  title="Intake Procedures"
  meta="What a kind of matter must clear before it opens, as a list the firm writes for itself."
  posture={canManage ? "draft" : "readOnly"}
/>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <Alert.Root variant="info">
      <Alert.Title>A Procedure Holds The Door</Alert.Title>
      <Alert.Description>
        A consultation of the kind a procedure binds does not open while a required step is
        unanswered. Each step is answered by whoever holds the fact: the conflicts record, the fee
        arrangement, a document produced onto the matter, the trust ledger, or a member recording
        that they did it. A member who may waive a step can open the matter without it, under their
        name and with the reason. Changing a procedure reaches every consultation of its kind at
        once. Magna Carta ships no procedures of its own.
      </Alert.Description>
    </Alert.Root>

    {#if readFailure !== null}
      <FailureNotice
        failure={readFailure.failure}
        title="Procedures Unavailable"
        fallback={readFailure.fallback}
      />
    {/if}
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
          <Select.Root
            type="single"
            value={draftMatterTypeId}
            onValueChange={chooseMatterType}
            disabled={saving}
          >
            <Select.Trigger id="procedure-matter-type" class="w-xs">
              {matterTypeName(draftMatterTypeId === EVERY_KIND ? null : draftMatterTypeId)}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={EVERY_KIND} label="Every kind of matter" />
              {#each matterTypes.filter((type) => type.active) as type (type.id)}
                <Select.Item value={type.id} label={type.name} />
              {/each}
            </Select.Content>
          </Select.Root>
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

    {#if procedures === null}
      <div class="flex flex-col gap-8">
        {#each [0, 1] as row (row)}
          <Skeleton class="h-48 w-full" />
        {/each}
      </div>
    {:else if procedures.length === 0}
      <EmptyState title="No procedures yet">
        A procedure is your own list of what a kind of matter must clear before you take it on: the
        conflicts check, the fee agreement, the engagement letter, the retainer, the questions the
        client has to answer. Write one here and every consultation of that kind is held to it.
      </EmptyState>
    {:else}
      <ul class="flex flex-col gap-8">
        {#each procedures as procedure (procedure.id)}
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
                            title="Retire this step. It stops being asked; records that answered it are kept."
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
                          <Select.Root
                            type="single"
                            value={stepKind}
                            onValueChange={chooseKind}
                            disabled={saving}
                          >
                            <Select.Trigger id="step-kind" class="w-xs">
                              {stepVocabulary.label}
                            </Select.Trigger>
                            <Select.Content>
                              {#each INTAKE_STEP_KIND_VOCABULARY as entry (entry.kind)}
                                <Select.Item value={entry.kind} label={entry.label} />
                              {/each}
                            </Select.Content>
                          </Select.Root>
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
                            <Select.Root
                              type="single"
                              value={stepReference}
                              onValueChange={chooseReference}
                              disabled={saving}
                            >
                              <Select.Trigger id="step-reference" class="w-xs">
                                {stepReference === "" ? "No template" : templateName(stepReference)}
                              </Select.Trigger>
                              <Select.Content>
                                <Select.Item value="" label="No template" />
                                {#each templates as template (template.templateId)}
                                  <Select.Item value={template.templateId} label={template.name} />
                                {/each}
                              </Select.Content>
                            </Select.Root>
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
  </div>
</div>
