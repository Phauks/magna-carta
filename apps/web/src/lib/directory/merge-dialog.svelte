<script lang="ts">
  /*
   * Folding one record into another.
   *
   * This is the most consequential act in the directory and the only one the product cannot take
   * back, so the window's whole job is to make what is about to happen plain BEFORE it happens.
   * Three things are on screen, in the order a person needs them:
   *
   *   1. WHICH RECORD SURVIVES. Named, both ways round, with a control to swap them. Getting this
   *      backwards is the mistake that actually happens, and it is silent afterwards.
   *   2. WHAT THE SURVIVOR ENDS UP CALLED. Every field the two records disagree about, with the
   *      choice sitting beside both values. A field they agree on needs no decision and is not
   *      dressed up as one.
   *   3. WHAT ELSE MOVES, and the one sentence that cannot be softened: nothing here undoes it.
   *
   * The plan is computed in merge-plan.ts, so the thing a person reads is the thing that is sent.
   * The acknowledgement is a real checkbox rather than a second confirm click, because a second
   * click is a reflex and a checkbox is a sentence somebody had to read past.
   *
   * IT IS A FORM ON THE ACTION DIALOG SHELL, NOT A DESTRUCTIVE ASK. Folding takes nothing away —
   * the subordinate is archived and every value survives on one record or the other — and the
   * panel carries fields: which record survives, which value wins where they differ, and the
   * acknowledgement. So it is the form kind, with the unsaved-work guard on every exit, and the
   * irreversibility is said once, in the alert. The commit is refused, with the reason beside it,
   * until the acknowledgement is ticked and nothing else stands in the way; the shell renders the
   * refusal, so this file states it once and never draws it.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import Label from "@magna-carta/design-system/label";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { mergeDirectoryEntities, type DirectoryEntityDetail } from "./directory-api.ts";
  import {
    defaultMergeChoices,
    mergePlan,
    survivorshipFrom,
    MERGE_CONSEQUENCES,
    MERGE_IRREVERSIBLE_STATEMENT,
    type MergeFieldChoice,
  } from "./merge-plan.ts";

  let {
    open = $bindable(false),
    left,
    right,
    mayEdit,
    editDisabledReason,
    onMerged,
  }: {
    open?: boolean;
    /** The record the merge was started from. It survives unless the two are swapped. */
    left: DirectoryEntityDetail;
    /** The candidate the merge was started against. */
    right: DirectoryEntityDetail;
    mayEdit: boolean;
    editDisabledReason?: string;
    onMerged: (mergeId: string) => void;
  } = $props();

  let swapped = $state(false);
  let choices = $state<Record<string, MergeFieldChoice>>({});
  let acknowledged = $state(false);
  let failure = $state<StatedFailure | null>(null);

  const master = $derived(swapped ? right : left);
  const subordinate = $derived(swapped ? left : right);
  const plan = $derived(mergePlan(master, subordinate));
  const differing = $derived(plan.fields.filter((field) => field.differs));
  const defaultChoices = $derived(defaultMergeChoices(plan));

  // A swap is a different plan, and a choice made against the old one would be a choice about a
  // field that has changed sides. The choices reset with the plan.
  let plannedFor = $state<string | null>(null);
  $effect(() => {
    const identity = `${plan.masterId}|${plan.subordinateId}`;
    if (plannedFor === identity) return;
    plannedFor = identity;
    choices = defaultChoices;
    acknowledged = false;
    failure = null;
  });

  /*
   * Why the commit is unavailable, or undefined when it is available. The plan's own refusal comes
   * first, then the member's standing to edit, then the acknowledgement: each is a reason the act
   * cannot go ahead, and the reader is told the one that applies rather than shown a dead control.
   */
  const refusal = $derived.by((): string | undefined => {
    if (plan.refusal !== null) return plan.refusal;
    if (!mayEdit) return editDisabledReason ?? "You can't change this record.";
    if (!acknowledged) return "Tick the acknowledgement to fold the records.";
    return undefined;
  });

  /**
   * Whether anything has been decided. Nothing is typed here, but a field choice or the ticked
   * acknowledgement is a decision the reader made, and leaving throws it away.
   */
  const started = $derived(
    acknowledged ||
      Object.entries(choices).some(([column, choice]) => defaultChoices[column] !== choice),
  );

  function reset(): void {
    swapped = false;
    choices = defaultChoices;
    acknowledged = false;
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    const outcome = await mergeDirectoryEntities(
      fetch,
      {
        masterId: plan.masterId,
        subordinateId: plan.subordinateId,
        survivorship: survivorshipFrom(plan, choices),
      },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onMerged(outcome.value.mergeId);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Couldn't merge the records.",
      "Neither record was changed.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Fold One Record into the Other"
  subtitle={{ facts: [plan.subordinateName, `folds into ${plan.masterName}`] }}
  commitLabel="Fold Into {plan.masterName}"
  commitBusyLabel="Folding"
  commitRefusal={refusal}
  width="record"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Records Not Merged"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-wrap items-start gap-16">
        <div class="flex flex-col gap-8">
          <FieldLabel as="span">Survives</FieldLabel>
          <EntityIdentity kind={plan.kind} name={plan.masterName} />
        </div>
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => (swapped = !swapped)}
          aria-label="Swap which record survives"
        >
          <ArrowLeftRight class="size-16" aria-hidden="true" />
          Swap
        </Button>
        <div class="flex flex-col gap-8">
          <FieldLabel as="span">Folded in</FieldLabel>
          <EntityIdentity kind={plan.kind} name={plan.subordinateName} />
        </div>
      </div>

      {#if differing.length > 0}
        <DataTable.Root>
          <DataTable.Caption class="sr-only">
            The fields the two records disagree about
          </DataTable.Caption>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>Field</DataTable.Head>
              <DataTable.Head>{plan.masterName}</DataTable.Head>
              <DataTable.Head>{plan.subordinateName}</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each differing as field (field.column)}
              <DataTable.Row>
                <DataTable.Cell>{field.label}</DataTable.Cell>
                <DataTable.Cell colspan={2}>
                  <RadioGroup.Root
                    class="flex flex-wrap gap-16"
                    disabled={busy}
                    value={choices[field.column] ?? "master"}
                    onValueChange={(chosen) =>
                      (choices = { ...choices, [field.column]: chosen as MergeFieldChoice })}
                  >
                    <div class="flex items-center gap-8">
                      <RadioGroup.Item value="master" id="merge-{field.column}-master" />
                      <Label for="merge-{field.column}-master">
                        {field.masterValue ?? "Not recorded"}
                      </Label>
                    </div>
                    <div class="flex items-center gap-8">
                      <RadioGroup.Item value="subordinate" id="merge-{field.column}-subordinate" />
                      <Label for="merge-{field.column}-subordinate">
                        {field.subordinateValue ?? "Not recorded"}
                      </Label>
                    </div>
                  </RadioGroup.Root>
                </DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
      {/if}

      <ul class="flex flex-col gap-8 text-sm text-text-muted">
        {#each MERGE_CONSEQUENCES as consequence (consequence)}
          <li>{consequence}</li>
        {/each}
      </ul>

      <Alert.Root variant="danger">
        <Alert.Title>This Can't Be Undone</Alert.Title>
        <Alert.Description>{MERGE_IRREVERSIBLE_STATEMENT}</Alert.Description>
      </Alert.Root>

      <div class="flex items-center gap-8">
        <Checkbox id="merge-acknowledged" disabled={busy} bind:checked={acknowledged} />
        <Label for="merge-acknowledged">
          I have read which record survives.
        </Label>
      </div>
    </div>
  {/snippet}
</ActionDialog>
