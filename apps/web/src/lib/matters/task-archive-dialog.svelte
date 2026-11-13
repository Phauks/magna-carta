<script lang="ts">
  /*
   * Putting a task away, and keeping it.
   *
   * ARCHIVING AND DELETING ARE THE TWO WAYS A TASK LEAVES A LIST, and they differ in exactly one
   * thing: this keeps the data, a delete takes it. So the panel says that outright rather than
   * asking somebody to infer it from two verbs.
   *
   * THE REASON IS OPTIONAL, and that is the whole difference from the cancellation this replaces.
   * That state required one, on the reasoning that the decision is the record — which is true of a
   * decision, and archiving is usually not one: somebody clearing work that is simply not happening
   * is not composing a memo. Requiring a sentence is why nobody ever used it.
   *
   * SO WHY A PANEL AT ALL, for an act with no required field? Because the reason is worth offering
   * at the moment it is cheap to give — a task put away with "the client withdrew the instruction"
   * against it answers a question a year later that nothing else in the record can — and because
   * putting something away is worth one deliberate gesture. It is a form rather than a confirmation
   * for the same reason: there is something to fill in, even though nothing has to be.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Textarea from "@magna-carta/design-system/textarea";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { archiveTask, newWriteKey, type MatterTask } from "$lib/matters/tasks-api.ts";

  let {
    open = $bindable(false),
    task = null,
    onArchived,
  }: {
    open?: boolean;
    /** The task being put away. Null between openings. */
    task?: MatterTask | null;
    /** It was archived; the surface re-reads. */
    onArchived: () => void;
  } = $props();

  const identity = $props.id();

  let reason = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    reason = "";
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    const subject = task;
    if (subject === null) return "refused";
    failure = null;
    const given = reason.trim();
    const outcome = await archiveTask(
      fetch,
      subject.id,
      given === "" ? null : given,
      newWriteKey(),
    );
    if (outcome.kind === "ok") {
      onArchived();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The task was not archived.",
      "Couldn't connect. Nothing changed. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Archive This Task"
  subtitle={task === null ? {} : { facts: [task.title] }}
  commitLabel="Archive Task"
  commitBusyLabel="Archiving"
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
        <Label for="{identity}-reason">Why, if you want to say (optional)</Label>
        <Textarea id="{identity}-reason" rows={3} disabled={busy} bind:value={reason} />
      </div>
      <p class="text-sm text-text-muted">
        The task leaves the list but keeps its details, documents and time. Restoring it puts it back where it was. To remove it for good, delete it instead.
      </p>
    </div>
  {/snippet}
</ActionDialog>
