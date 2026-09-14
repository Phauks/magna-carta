<script lang="ts">
  /*
   * The firm decided not to do a task, and why.
   *
   * IT IS A FORM, NOT A CONFIRMATION, because the reason is required. "We decided not to" with no
   * explanation tells a firm nothing when somebody reads the matter back a year later, and a
   * question with a Yes and a No has nowhere to put the only fact worth keeping.
   *
   * IT DOES NOT SAY "CANCEL" IN ITS VERB. Every panel in the product leaves through a control that
   * says Cancel, so a commit that also said it would be two controls with one word and opposite
   * meanings. The act is naming a decision; the state it leaves behind is Cancelled, and the panel
   * says so in the fields rather than in the button.
   *
   * CANCELLING IS NOT DELETING, and the copy keeps them apart. This keeps the task and the firm's
   * decision about it; deleting is for a task that should not exist at all.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Textarea from "@magna-carta/design-system/textarea";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { cancelTask, newWriteKey, type MatterTask } from "$lib/matters/tasks-api.ts";

  let {
    open = $bindable(false),
    task = null,
    onCancelled,
  }: {
    open?: boolean;
    /** The task the decision is about. Null between openings. */
    task?: MatterTask | null;
    /** The decision was recorded; the surface re-reads. */
    onCancelled: () => void;
  } = $props();

  const identity = $props.id();

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);

  const refusal = $derived(
    reason.trim() === ""
      ? "The reason is the record. Say why the firm is not doing this."
      : undefined,
  );

  function reset(): void {
    reason = "";
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    const subject = task;
    const given = reason.trim();
    if (subject === null || given === "") return "refused";
    failure = null;
    const outcome = await cancelTask(fetch, subject.id, given, newWriteKey());
    if (outcome.kind === "ok") {
      onCancelled();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The task was not cancelled.",
      "Nothing answered. Nothing was recorded, so pressing again records the decision once.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Not Doing This Task"
  subtitle={task?.title ?? ""}
  commitLabel="Record the Decision"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="{identity}-reason">Why is the firm not doing this?</Label>
        <Textarea id="{identity}-reason" rows={4} disabled={busy} bind:value={reason} />
      </div>
      <p class="text-sm text-text-muted">
        The task stays on the record, showing as Cancelled with this reason against it. Deleting is
        the other act, and it is for a task that should not exist at all.
      </p>
    </div>
  {/snippet}
</ActionDialog>
