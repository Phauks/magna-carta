<script lang="ts">
  /*
   * Setting a call or a text aside — saying it belongs to no matter, and why.
   *
   * THE REASON IS THE WHOLE ACT. "Not a matter" on its own would empty the queue and lose the one
   * fact anybody would later want: whether the firm's number is being called by salesmen, whether
   * enquiries are arriving and dying, or whether half the traffic is the firm's own business. Those
   * are three different problems with three different answers, so the vocabulary is closed and the
   * act cannot be performed without choosing one.
   *
   * NOTHING IS DESTROYED. The row keeps its words, its number and its instant; it leaves the queue
   * and nothing else. A firm that decides a written-off call was real work after all puts it back
   * from the same record, and the log carries both acts.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { RecordReference } from "@magna-carta/design-system/record-reference";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Label from "@magna-carta/design-system/label";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { DISPOSITION_CHOICES } from "./communication-vocabulary.ts";
  import {
    newWriteKey,
    setCommunicationDisposition,
    type CommunicationDisposition,
  } from "./communications-api.ts";

  let {
    open = $bindable(false),
    communicationId,
    reference,
    onSetAside,
  }: {
    open?: boolean;
    /** The row being set aside. Null while nothing is chosen, which keeps the dialog closed. */
    communicationId: string | null;
    /** That row by the number somebody quotes — what is being taken out of the queue, named. */
    reference: RecordReference | null;
    onSetAside: () => void;
  } = $props();

  const ITEMS = DISPOSITION_CHOICES.map((choice) => ({
    value: choice.value,
    label: choice.label,
    meaning: choice.meaning,
  }));

  let chosen = $state<CommunicationDisposition | null>(null);
  let failure = $state<StatedFailure | null>(null);

  const refusal = $derived(chosen === null ? "Why it is on no matter." : undefined);

  function reset(): void {
    chosen = null;
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    if (communicationId === null || chosen === null) return "refused";
    // A retried submit is the same decision, not a second one.
    const outcome = await setCommunicationDisposition(
      fetch,
      communicationId,
      chosen,
      newWriteKey(),
    );
    if (outcome.kind === "ok") {
      onSetAside();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "It could not be set aside.",
      "Couldn't connect. It's still waiting to send.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Set It Aside"
  subtitle={reference === null ? undefined : { reference }}
  commitLabel="Set Aside"
  commitBusyLabel="Setting aside"
  commitRefusal={refusal}
  unsavedChanges={chosen !== null}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="It Was Not Set Aside"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label id="set-aside-reason-label">Why</Label>
      <Select.Root
        type="single"
        items={ITEMS}
        disabled={busy}
        bind:value={
          () => chosen ?? "",
          (picked) => (chosen = (picked as CommunicationDisposition) || null)
        }
      >
        <Select.Trigger aria-labelledby="set-aside-reason-label">
          <Select.Value placeholder={placeholderOf("Why")} />
        </Select.Trigger>
        <Select.Content>
          {#each ITEMS as item (item.value)}
            <Select.Item value={item.value} label={item.label} title={item.meaning} />
          {/each}
        </Select.Content>
      </Select.Root>
      {#if chosen !== null}
        <p class="text-xs text-text-muted">
          {ITEMS.find((item) => item.value === chosen)?.meaning}
        </p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
