<script lang="ts">
  /*
   * The form builder — the firm's questions, its link, and the act of putting it on the internet.
   *
   * THE ONE THING THIS SCREEN HAS TO MAKE OBVIOUS is that editing and publishing are different acts.
   * Questions are edited on a WORKING DRAFT and nobody outside the firm sees them; publishing freezes
   * that draft and points the public link at it. A firm that changes a live form's questions is not
   * rewriting what people already answered — their answers name the version they were asked, and that
   * version stays readable beside them forever. The banner at the top says which of the two states
   * the form is in, because guessing wrong means either believing a change is live when it is not, or
   * believing it is private when it is not.
   *
   * THE LINK IS SHOWN AS THE VISITOR WILL SEE IT, not as a token to assemble. Rotating it is offered
   * with what it costs stated first — every link already handed out stops working — because that is
   * the whole reason somebody reaches for it and also the whole reason they might not mean to.
   *
   * WHAT THE QUESTION PICKER DELIBERATELY DOES NOT OFFER is the firm's own custom fields. One of
   * those can point at a record in the directory, and a stranger must never be able to aim a value at
   * a person the firm knows. A firm that needs a question the list does not have writes a `question`.
   */
  import { page } from "$app/state";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Textarea from "@magna-carta/design-system/textarea";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import { FIELD_KIND_VOCABULARY, fieldKindLabel, fieldKindTakesOptions } from "$lib/intake-forms/field-kinds.ts";
  import {
    addIntakeFormField,
    editIntakeForm,
    editIntakeFormField,
    newWriteKey,
    publicFormUrl,
    publishIntakeForm,
    readIntakeForm,
    removeIntakeFormField,
    reorderIntakeFormFields,
    rotateIntakeFormToken,
    setIntakeFormClosed,
    type IntakeFormDetail,
    type IntakeFormFieldKind,
  } from "$lib/intake-forms/intake-forms-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const formId = $derived(page.params.formId ?? "");

  let form = $state<IntakeFormDetail | null>(null);
  let session = $state<SessionBootstrap | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let busy = $state(false);

  // The new-question row.
  let newKind = $state<IntakeFormFieldKind>("question");
  let newLabel = $state("");
  let newHelpText = $state("");
  let newRequired = $state(false);
  let newOptions = $state("");

  // The form's own settings, edited in place and saved together.
  let settingsName = $state("");
  let settingsTitle = $state("");
  let settingsIntroduction = $state("");
  let settingsConfirmation = $state("");

  let rotateArmed = $state(false);

  async function read(): Promise<void> {
    if (formId === "") return;
    const outcome = await readIntakeForm(fetch, formId);
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "This form could not be read.");
      return;
    }
    form = outcome.value;
    failure = null;
    settingsName = outcome.value.name;
    settingsTitle = outcome.value.title;
    settingsIntroduction = outcome.value.introduction ?? "";
    settingsConfirmation = outcome.value.confirmationMessage ?? "";
  }

  $effect(() => {
    void (async () => {
      const bootstrap = await readSession(fetch);
      if (bootstrap.kind === "ok") session = bootstrap.value;
      await read();
    })();
  });

  const firmId = $derived(session?.firm?.id ?? "");
  const link = $derived(
    form === null || firmId === ""
      ? null
      : publicFormUrl(page.url.origin, firmId, form.publicToken),
  );

  /**
   * Run one write and re-read the form.
   *
   * Every act on this screen changes what the draft or the live page is, and the screen's whole job
   * is to say which — so nothing here updates state optimistically. A re-read is one request and it
   * is what keeps the banner at the top honest.
   */
  async function run(
    act: () => Promise<ApiOutcome<unknown>>,
    whenItFails: string,
  ): Promise<void> {
    busy = true;
    const outcome = await act();
    busy = false;
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, whenItFails);
      return;
    }
    await read();
  }

  async function saveSettings(): Promise<void> {
    if (form === null) return;
    await run(() =>
      editIntakeForm(
        fetch,
        form!.id,
        {
          name: settingsName.trim(),
          title: settingsTitle.trim(),
          introduction: settingsIntroduction.trim() === "" ? null : settingsIntroduction.trim(),
          confirmationMessage:
            settingsConfirmation.trim() === "" ? null : settingsConfirmation.trim(),
          submissionBudgetPerDay: form!.submissionBudgetPerDay,
        },
        newWriteKey(),
      ),
      "These settings could not be saved.",
    );
  }

  async function addQuestion(): Promise<void> {
    if (form === null || newLabel.trim() === "") return;
    const options = fieldKindTakesOptions(newKind)
      ? newOptions
          .split("\n")
          .map((option) => option.trim())
          .filter((option) => option !== "")
      : null;
    await run(() =>
      addIntakeFormField(
        fetch,
        form!.id,
        {
          kind: newKind,
          label: newLabel.trim(),
          helpText: newHelpText.trim() === "" ? null : newHelpText.trim(),
          required: newRequired,
          options,
        },
        newWriteKey(),
      ),
      "That question could not be added.",
    );
    newLabel = "";
    newHelpText = "";
    newOptions = "";
    newRequired = false;
  }

  async function move(index: number, delta: number): Promise<void> {
    if (form === null) return;
    const ids = form.fields.map((field) => field.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await run(
      () => reorderIntakeFormFields(fetch, form!.id, ids, newWriteKey()),
      "The questions could not be reordered.",
    );
  }

  const canPublish = $derived(form !== null && form.fields.length > 0);
</script>

<svelte:head><title>{form?.name ?? "Form"} · Magna Carta</title></svelte:head>

<ScreenHeader title={form?.name ?? "Form"} back="forms">
  {#snippet actions()}
    {#if form !== null}
      <Button href={`/forms/${form.id}/submissions`} variant="secondary">
        Submissions{form.waitingSubmissions > 0 ? ` (${form.waitingSubmissions})` : ""}
      </Button>
      <Button onclick={() => void run(
        () => publishIntakeForm(fetch, form!.id, newWriteKey()),
        "This form could not be published.",
      )} disabled={busy || !canPublish}>
        Publish
      </Button>
    {/if}
  {/snippet}
</ScreenHeader>

{#if failure !== null}
  <FailureNotice
    failure={failure.failure}
    title="This Form Is Unavailable"
    fallback={failure.fallback}
    onRetry={() => void read()}
  />
{/if}

<LoadingRegion loading={form === null} label="Reading this form">
  {#if form !== null}
    <div class="flex max-w-3xl flex-col gap-24">
      <!--
        Which of the two states the form is in, said plainly. Getting this wrong in either direction
        is the expensive mistake this screen exists to prevent.
      -->
      {#if form.status === "draft"}
        <Alert.Root variant="info">
          <Alert.Title>This form is not on the internet.</Alert.Title>
          <Alert.Description>
            Nobody outside the firm can reach it. Publish it when the questions are right; you can
            change them afterwards and publish again.
          </Alert.Description>
        </Alert.Root>
      {:else if form.status === "closed"}
        <Alert.Root variant="warning">
          <Alert.Title>This form is closed.</Alert.Title>
          <Alert.Description>
            Its link answers as though it does not exist. Every question and every enquiry it already
            received is kept.
            <Button
              variant="secondary"
              size="sm"
              class="ml-8"
              disabled={busy}
              onclick={() => void run(
                () => setIntakeFormClosed(fetch, form!.id, false, newWriteKey()),
                "This form could not be reopened.",
              )}
            >
              Reopen
            </Button>
          </Alert.Description>
        </Alert.Root>
      {:else if form.hasUnpublishedChanges}
        <Alert.Root variant="warning">
          <Alert.Title>Your changes are not live yet.</Alert.Title>
          <Alert.Description>
            The form on the internet still asks the questions you published last. Publish to replace
            it. Answers people already sent stay attached to the questions they were actually asked.
          </Alert.Description>
        </Alert.Root>
      {:else}
        <Alert.Root variant="success">
          <Alert.Title>This form is live.</Alert.Title>
          <Alert.Description>Anyone with the link can fill it in.</Alert.Description>
        </Alert.Root>
      {/if}

      <!-- ---- the link ---- -->
      {#if form.status !== "draft" && link !== null}
        <section class="flex flex-col gap-8">
          <h2 class="text-lg font-semibold">The link</h2>
          <Input readonly value={link} aria-label="The public link to this form" />
          <p class="text-xs text-text-muted">
            Paste this into an email or behind a button on your website.
          </p>
          {#if rotateArmed}
            <Alert.Root variant="danger">
              <Alert.Title>Every link you have handed out will stop working.</Alert.Title>
              <Alert.Description>
                A new link replaces this one. Anyone holding the old one — in an email, on your
                website, in a bookmark — will be told the form is not available. The form itself,
                its questions and its enquiries are all kept.
                <div class="mt-8 flex gap-8">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onclick={async () => {
                      rotateArmed = false;
                      await run(
                        () => rotateIntakeFormToken(fetch, form!.id, newWriteKey()),
                        "The link could not be replaced.",
                      );
                    }}
                  >
                    Replace the link
                  </Button>
                  <Button variant="secondary" size="sm" onclick={() => (rotateArmed = false)}>
                    Keep it
                  </Button>
                </div>
              </Alert.Description>
            </Alert.Root>
          {:else}
            <div class="flex gap-8">
              <Button variant="secondary" size="sm" onclick={() => (rotateArmed = true)}>
                Replace the link
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onclick={() => void run(
                  () => setIntakeFormClosed(fetch, form!.id, true, newWriteKey()),
                  "This form could not be closed.",
                )}
              >
                Close the form
              </Button>
            </div>
          {/if}
        </section>
      {/if}

      <!-- ---- the questions ---- -->
      <section class="flex flex-col gap-12">
        <h2 class="text-lg font-semibold">Questions</h2>

        {#if form.fields.length === 0}
          <EmptyState title="No Questions Yet">
            A form needs at least one question before it can be published. Most start with a name, a
            way to reach the person, and one long box for what happened.
          </EmptyState>
        {:else}
          <ul class="flex flex-col gap-8">
            {#each form.fields as field, index (field.id)}
              <li class="flex flex-col gap-6 rounded border border-border-subtle p-12">
                <div class="flex items-start justify-between gap-12">
                  <div class="flex flex-col gap-4">
                    <div class="flex items-center gap-8">
                      <span class="font-medium">{field.label}</span>
                      {#if field.required}<Badge>Required</Badge>{/if}
                    </div>
                    <span class="text-xs text-text-muted">{fieldKindLabel(field.kind)}</span>
                    {#if field.helpText !== null}
                      <span class="text-xs text-text-muted">{field.helpText}</span>
                    {/if}
                    {#if field.options !== null}
                      <span class="text-xs text-text-muted">
                        Choices: {field.options.join(", ")}
                      </span>
                    {/if}
                  </div>
                  <div class="flex gap-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Move up"
                      disabled={busy || index === 0}
                      onclick={() => void move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Move down"
                      disabled={busy || index === form.fields.length - 1}
                      onclick={() => void move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove"
                      disabled={busy}
                      onclick={() =>
                        void run(
                          () => removeIntakeFormField(fetch, form!.id, field.id, newWriteKey()),
                          "That question could not be removed.",
                        )}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- ---- adding one ---- -->
        <div class="flex flex-col gap-8 rounded border border-border-subtle p-12">
          <div class="flex flex-col gap-6">
            <Label id="new-question-kind-label">What to ask for</Label>
            <Select.Root
              type="single"
              value={newKind}
              onValueChange={(value) => (newKind = (value ?? "question") as IntakeFormFieldKind)}
            >
              <Select.Trigger aria-labelledby="new-question-kind-label">
                {fieldKindLabel(newKind)}
              </Select.Trigger>
              <Select.Content>
                {#each FIELD_KIND_VOCABULARY as entry (entry.kind)}
                  <Select.Item value={entry.kind}>{entry.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <p class="text-xs text-text-muted">
              {FIELD_KIND_VOCABULARY.find((entry) => entry.kind === newKind)?.note ?? ""}
            </p>
          </div>

          <div class="flex flex-col gap-6">
            <Label for="new-question-label">How to word it</Label>
            <Input id="new-question-label" bind:value={newLabel} disabled={busy} autocomplete="off" />
          </div>

          <div class="flex flex-col gap-6">
            <Label for="new-question-help">Help text</Label>
            <Input id="new-question-help" bind:value={newHelpText} disabled={busy} autocomplete="off" />
            <p class="text-xs text-text-muted">
              Optional. Sits under the field and stays there while somebody types.
            </p>
          </div>

          {#if fieldKindTakesOptions(newKind)}
            <div class="flex flex-col gap-6">
              <Label for="new-question-options">The choices</Label>
              <Textarea id="new-question-options" rows={4} bind:value={newOptions} disabled={busy} />
              <p class="text-xs text-text-muted">One per line.</p>
            </div>
          {/if}

          <div class="flex items-center gap-8">
            <Checkbox id="new-question-required" bind:checked={newRequired} disabled={busy} />
            <Label for="new-question-required">The form cannot be sent without this</Label>
          </div>

          <div>
            <Button
              size="sm"
              disabled={busy || newLabel.trim() === ""}
              onclick={() => void addQuestion()}
            >
              <Plus aria-hidden="true" />
              Add question
            </Button>
          </div>
        </div>
      </section>

      <!-- ---- the form's own words ---- -->
      <section class="flex flex-col gap-12">
        <h2 class="text-lg font-semibold">What a visitor reads</h2>

        <div class="flex flex-col gap-6">
          <Label for="settings-name">Name</Label>
          <Input id="settings-name" bind:value={settingsName} disabled={busy} autocomplete="off" />
          <p class="text-xs text-text-muted">Your firm's name for it. Only members see this.</p>
        </div>

        <div class="flex flex-col gap-6">
          <Label for="settings-title">Title</Label>
          <Input id="settings-title" bind:value={settingsTitle} disabled={busy} autocomplete="off" />
        </div>

        <div class="flex flex-col gap-6">
          <Label for="settings-introduction">Introduction</Label>
          <Textarea id="settings-introduction" rows={3} bind:value={settingsIntroduction} disabled={busy} />
        </div>

        <div class="flex flex-col gap-6">
          <Label for="settings-confirmation">What they are told afterwards</Label>
          <Textarea id="settings-confirmation" rows={3} bind:value={settingsConfirmation} disabled={busy} />
          <!--
            The one piece of guidance the platform cannot enforce, so it is said where it is needed.
            The rule is real: the reply must give away no more than the status code does.
          -->
          <p class="text-xs text-text-muted">
            Keep it general. "We have received your enquiry and someone will be in touch" is right.
            Naming a person or a practice area is not — the form has not decided who will read it,
            and saying so tells a stranger something about the firm.
          </p>
        </div>

        <div>
          <Button variant="secondary" disabled={busy} onclick={() => void saveSettings()}>
            Save
          </Button>
        </div>
        <p class="text-xs text-text-muted">
          These are not questions, so saving them changes the live page straight away — publishing is
          only for the questions.
        </p>
      </section>
    </div>
  {/if}
</LoadingRegion>
