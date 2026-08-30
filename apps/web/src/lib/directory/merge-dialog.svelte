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
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import Merge from "@lucide/svelte/icons/merge";
  import { mergeDirectoryEntities, type DirectoryEntityDetail } from "./directory-api.ts";
  import EntityIdentity from "./entity-identity.svelte";
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
  let submitting = $state(false);
  let failure = $state<string | null>(null);

  const master = $derived(swapped ? right : left);
  const subordinate = $derived(swapped ? left : right);
  const plan = $derived(mergePlan(master, subordinate));
  const differing = $derived(plan.fields.filter((field) => field.differs));

  // A swap is a different plan, and a choice made against the old one would be a choice about a
  // field that has changed sides. The choices reset with the plan.
  let plannedFor = $state<string | null>(null);
  $effect(() => {
    const identity = `${plan.masterId}|${plan.subordinateId}`;
    if (plannedFor === identity) return;
    plannedFor = identity;
    choices = defaultMergeChoices(plan);
    acknowledged = false;
    failure = null;
  });

  const blockedReason = $derived(
    plan.refusal ?? (mayEdit ? undefined : editDisabledReason) ?? undefined,
  );

  async function submit(): Promise<void> {
    if (submitting || !acknowledged || blockedReason !== undefined) return;
    submitting = true;
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
    submitting = false;
    if (outcome.kind === "ok") {
      open = false;
      onMerged(outcome.value.mergeId);
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. Neither record was changed."
        : (outcome.problem.detail ?? "The records could not be folded together.");
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-3xl">
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Dialog.Title>Fold One Record Into The Other</Dialog.Title>
        <Dialog.Description>
          One record survives and carries everything. The other is archived and stops standing on its
          own.
        </Dialog.Description>
      </div>

      <div class="flex flex-wrap items-start gap-16">
        <div class="flex flex-col gap-8">
          <span class="text-xs text-text-muted uppercase">Survives</span>
          <EntityIdentity kind={plan.kind} name={plan.masterName} />
        </div>
        <Button
          variant="secondary"
          onclick={() => (swapped = !swapped)}
          aria-label="Swap which record survives"
        >
          <ArrowLeftRight class="size-16" aria-hidden="true" />
          Swap
        </Button>
        <div class="flex flex-col gap-8">
          <span class="text-xs text-text-muted uppercase">Folded in</span>
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
      {:else}
        <p class="text-sm text-text-muted">
          The two records agree on every field, so there is nothing to choose between.
        </p>
      {/if}

      <ul class="flex flex-col gap-8 text-sm text-text-muted">
        {#each MERGE_CONSEQUENCES as consequence (consequence)}
          <li>{consequence}</li>
        {/each}
      </ul>

      <Alert.Root variant="danger">
        <Alert.Title>This Cannot Be Undone Here</Alert.Title>
        <Alert.Description>{MERGE_IRREVERSIBLE_STATEMENT}</Alert.Description>
      </Alert.Root>

      <div class="flex items-center gap-8">
        <Checkbox id="merge-acknowledged" bind:checked={acknowledged} />
        <Label for="merge-acknowledged">
          I have read which record survives and accept that this cannot be undone.
        </Label>
      </div>

      {#if failure !== null}
        <Alert.Root variant="danger">
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}

      <div class="flex items-center justify-end gap-16">
        {#if blockedReason !== undefined}
          <p class="me-auto text-xs text-text-muted">{blockedReason}</p>
        {/if}
        <Dialog.Close
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={submitting}
        >
          Cancel
        </Dialog.Close>
        <Button
          variant="destructive"
          disabled={submitting || !acknowledged || blockedReason !== undefined}
          title={blockedReason}
          onclick={submit}
        >
          <Merge class="size-16" aria-hidden="true" />
          {submitting ? "Folding" : "Fold Into " + plan.masterName}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
