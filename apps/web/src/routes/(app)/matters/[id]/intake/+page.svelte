<script lang="ts">
  /*
   * The matter's intake: what this kind of matter must clear before it opens, and where each step
   * stands.
   *
   * EVERY ANSWER ON THIS SCREEN IS SOMEBODY ELSE'S. A step is answered by the subsystem that owns
   * the fact — the conflicts record, the fee arrangement, a document produced onto the matter, the
   * trust ledger — or by a member recording that they did it, and the row repeats what they said
   * in their words. This screen summarises nothing into a word of its own: there is no badge that
   * means "cleared", only a mark for a step that is answered and a finding for a required one that
   * is not. The one number it states is how many required steps are outstanding, which is a fact
   * about the firm's procedure rather than about the client.
   *
   * WHAT A PERSON DOES HERE. Records a step they did, with a note; waives a step, with the reason,
   * where their role allows; reopens an answer that no longer stands. Where a step's fact is made
   * elsewhere — on Conflicts, in the status window, on Files — the row says so and offers the way
   * there rather than a control that would pretend to make the fact here.
   *
   * ON AN OPEN MATTER THE FUNNEL HAS ENDED: nothing here is recordable, and what is shown is the
   * record of the intake as it stood, with its history folded beneath.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import StatusMark from "@magna-carta/design-system/status-mark";
  import Textarea from "@magna-carta/design-system/textarea";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { claimMatterCreate } from "$lib/matters/create-action.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import { readSession } from "$lib/matters/matters-api.ts";
  import { newWriteKey } from "$lib/matters/tasks-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    readIntakeChecklist,
    recordIntakeStep,
    reopenIntakeStep,
    waiveIntakeStep,
    type IntakeChecklist,
    type IntakeChecklistStep,
  } from "$lib/intake/intake-api.ts";
  import {
    describeIntakeRecord,
    intakeChecklistSummary,
    intakeStepActions,
    intakeStepKindLabel,
    intakeStepKindVocabulary,
    intakeStepMark,
  } from "$lib/intake/intake-procedure.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  let checklist = $state<IntakeChecklist | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  let permissions = $state<readonly string[]>([]);
  let historyShown = $state(false);

  /** The step a window is open for, and which act it asks. */
  let acting = $state<{ step: IntakeChecklistStep; act: "record" | "waive" } | null>(null);
  let dialogOpen = $state(false);
  let words = $state("");
  let busy = $state(false);

  claimMatterCreate("intake", () => ({
    title: "Steps come from the firm's intake procedure, written under Settings.",
    refusal: "Steps come from the firm's intake procedure, written under Settings.",
    run: () => undefined,
  }));

  const roster = $derived(firmRoster.members ?? []);
  function memberName(userId: string): string {
    return roster.find((member) => member.userId === userId)?.displayName ?? userId;
  }

  $effect(() => {
    if (isSample) return;
    void readSession(fetch).then((outcome) => {
      permissions = outcome.kind === "ok" ? outcome.value.permissions : [];
    });
    void refresh();
  });

  async function refresh(): Promise<void> {
    const outcome = await readIntakeChecklist(fetch, matter.id);
    if (outcome.kind !== "ok") {
      readFailure = stated(outcome.failure, "The matter's intake could not be read.");
      return;
    }
    readFailure = null;
    checklist = outcome.value;
  }

  const summary = $derived(checklist === null ? "" : intakeChecklistSummary(checklist));

  function stepHref(step: IntakeChecklistStep): string | null {
    const slug = intakeStepKindVocabulary(step.kind).sectionSlug;
    if (slug === null) return null;
    if (slug === "conflicts") return `/conflicts/matters/${encodeURIComponent(matter.id)}`;
    return `/matters/${encodeURIComponent(matter.id)}/${slug}`;
  }

  function open(step: IntakeChecklistStep, act: "record" | "waive"): void {
    acting = { step, act };
    words = "";
    writeFailure = null;
    dialogOpen = true;
  }

  async function reopen(step: IntakeChecklistStep): Promise<void> {
    if (busy) return;
    busy = true;
    writeFailure = null;
    const outcome = await reopenIntakeStep(fetch, matter.id, step.stepId, newWriteKey());
    busy = false;
    if (outcome.kind !== "ok") {
      writeFailure = stated(outcome.failure, "The step was not reopened.");
      return;
    }
    await refresh();
  }

  async function commit(): Promise<ActionOutcome> {
    const current = acting;
    if (current === null) return "refused";
    const text = words.trim();
    if (current.act === "waive" && text === "") return "refused";
    busy = true;
    writeFailure = null;
    const key = newWriteKey();
    const outcome =
      current.act === "record"
        ? await recordIntakeStep(fetch, matter.id, current.step.stepId, text === "" ? null : text, key)
        : await waiveIntakeStep(fetch, matter.id, current.step.stepId, text, key);
    busy = false;
    if (outcome.kind !== "ok") {
      writeFailure = stated(
        outcome.failure,
        current.act === "record" ? "The step was not recorded." : "The step was not waived.",
      );
      return "refused";
    }
    await refresh();
    return "committed";
  }

  const commitRefusal = $derived.by((): string | undefined => {
    if (acting?.act === "waive" && words.trim() === "") return "A waiver needs the reason.";
    return undefined;
  });
</script>

<svelte:head>
  <title>Intake · {matter.title} · Magna Carta</title>
</svelte:head>

<div class="flex flex-col gap-16">
  <div class="flex flex-col gap-4 border-b border-border-strong pb-8">
    <FieldLabel as="h2">Intake</FieldLabel>
    {#if summary !== ""}
      <p class="text-sm text-text-muted">{summary}</p>
    {/if}
  </div>

  {#if isSample}
    <EmptyState title="A sample matter has no intake">
      This matter is one of the in-repo samples and has no firm behind it, so there is no procedure
      to hold it to.
    </EmptyState>
  {:else if readFailure !== null}
    <FailureNotice
      failure={readFailure.failure}
      title="Intake Unavailable"
      fallback={readFailure.fallback}
    />
  {:else if checklist === null}
    <div class="flex flex-col gap-8">
      {#each [0, 1, 2] as row (row)}
        <Skeleton class="h-48 w-full" />
      {/each}
    </div>
  {:else if checklist.steps.length === 0}
    <EmptyState title="No procedure binds this kind of matter">
      The firm's intake procedures are written under Settings. A procedure bound to this matter's
      kind, or to every kind, would list its steps here.
    </EmptyState>
  {:else}
    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure.failure}
        title="Nothing Changed"
        fallback={writeFailure.fallback}
      />
    {/if}
    <ul class="flex flex-col gap-8">
      {#each checklist.steps as step (step.stepId)}
        {@const mark = intakeStepMark(step)}
        {@const actions = intakeStepActions(step, checklist.matterStatus, permissions)}
        {@const href = stepHref(step)}
        <li class="flex flex-col gap-8 rounded-md border border-border-strong p-16">
          <div class="flex flex-wrap items-start justify-between gap-8">
            <div class="flex items-start gap-8">
              {#if mark === "satisfied"}
                <!-- The word beside it says the same thing, so the mark is decoration here. -->
                <StatusMark decorative class="mt-2 size-16" />
              {:else if mark === "outstanding"}
                <CircleAlert
                  class="mt-2 size-16 shrink-0 text-status-danger-subtle-foreground"
                  aria-hidden="true"
                />
              {:else}
                <CircleDashed class="mt-2 size-16 shrink-0 text-text-subtle" aria-hidden="true" />
              {/if}
              <div class="flex flex-col gap-4">
                <div class="flex flex-wrap items-center gap-8">
                  <span class={mark === "satisfied" ? "text-text-muted" : "text-text-default"}>
                    {step.title}
                  </span>
                  <Badge variant="neutral">{intakeStepKindLabel(step.kind)}</Badge>
                  {#if !step.required}
                    <span class="text-xs text-text-muted">Optional</span>
                  {/if}
                  {#if checklist.procedures.length > 1}
                    <span class="text-xs text-text-muted">{step.procedureName}</span>
                  {/if}
                </div>
                {#if step.instructions !== null}
                  <p class="text-xs text-text-muted">{step.instructions}</p>
                {/if}
                <!-- Whoever answered, in their words. Red only for a required finding. -->
                <p
                  class={mark === "outstanding"
                    ? "text-sm text-status-danger-subtle-foreground"
                    : "text-sm text-text-muted"}
                >
                  {step.standing.statement}
                </p>
                {#if step.record !== null}
                  <p class="text-xs text-text-subtle">
                    {memberName(step.record.recordedBy)} · {formatInstant(step.record.recordedAt)}
                  </p>
                {/if}
              </div>
            </div>
            <div class="flex flex-wrap gap-4">
              {#if href !== null && step.record === null}
                <Button variant="ghost" size="sm" {href} title="Where this step's fact is made">
                  <ExternalLink class="size-16" aria-hidden="true" />
                  {intakeStepKindVocabulary(step.kind).sectionSlug === "conflicts"
                    ? "Conflicts"
                    : intakeStepKindVocabulary(step.kind).sectionSlug === "overview"
                      ? "Status"
                      : intakeStepKindVocabulary(step.kind).sectionSlug === "files"
                        ? "Files"
                        : "Trust"}
                </Button>
              {/if}
              {#if actions.record}
                <Button variant="secondary" size="sm" disabled={busy} onclick={() => open(step, "record")}>
                  Record Done
                </Button>
              {/if}
              {#if actions.waive}
                <Button variant="secondary" size="sm" disabled={busy} onclick={() => open(step, "waive")}>
                  Waive
                </Button>
              {/if}
              {#if actions.reopen}
                <Button variant="ghost" size="sm" disabled={busy} onclick={() => reopen(step)}>
                  Reopen
                </Button>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ul>

    {#if checklist.history.length > 0}
      <Button
        variant="ghost"
        size="sm"
        class="self-start"
        aria-expanded={historyShown}
        onclick={() => (historyShown = !historyShown)}
      >
        {#if historyShown}
          <ChevronDown class="size-16" aria-hidden="true" />
        {:else}
          <ChevronRight class="size-16" aria-hidden="true" />
        {/if}
        {historyShown
          ? "Hide the history"
          : `Show the history (${String(checklist.history.length)} ${checklist.history.length === 1 ? "record" : "records"})`}
      </Button>
      {#if historyShown}
        <ul class="flex flex-col gap-8 text-sm">
          {#each checklist.history as record (record.id)}
            {@const step = checklist.steps.find((candidate) => candidate.stepId === record.stepId)}
            <li class="flex flex-col gap-2">
              <span class="flex flex-wrap items-baseline justify-between gap-16">
                <span class={record.supersededAt === null ? "" : "text-text-muted"}>
                  {step?.title ?? "A retired step"} · {describeIntakeRecord(record)}
                </span>
                <span class="text-xs text-text-muted tabular-nums">
                  {memberName(record.recordedBy)} · {formatInstant(record.recordedAt)}
                </span>
              </span>
              {#if record.supersededAt !== null}
                <span class="text-xs text-text-subtle">
                  Set aside {formatInstant(record.supersededAt)}{record.supersededBy === null
                    ? ""
                    : ` by ${memberName(record.supersededBy)}`}.
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
</div>

<!-- Recording and waiving ask for words, so each opens its own short window over the list. -->
<ActionDialog
  bind:open={dialogOpen}
  heading={acting?.act === "waive" ? "Waive Step" : "Record Step"}
  commitLabel={acting?.act === "waive" ? "Waive" : "Record Done"}
  commitBusyLabel={acting?.act === "waive" ? "Waiving" : "Recording"}
  {commitRefusal}
  onCommit={commit}
  onDismiss={() => (acting = null)}
>
  {#snippet subtitle()}
    {acting?.step.title ?? ""}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-8">
      {#if acting?.act === "waive"}
        <p class="text-sm text-text-muted">
          The matter may open without this step. The waiver is recorded under your name with the
          reason, and stays on the record.
        </p>
        <Label for="intake-words">Reason</Label>
      {:else}
        <p class="text-sm text-text-muted">
          Recorded under your name. Add a word on what you did, where it helps the next reader.
        </p>
        <Label for="intake-words">Note</Label>
      {/if}
      <Textarea id="intake-words" bind:value={words} rows={3} disabled={busy} />
    </div>
  {/snippet}
</ActionDialog>
