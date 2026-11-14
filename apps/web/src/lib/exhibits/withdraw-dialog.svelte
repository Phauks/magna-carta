<script lang="ts">
  /*
   * Withdrawing an exhibit from a set that has gone out. The exhibit keeps its label and its row,
   * because the other side and the court already hold that numbering; it is marked withdrawn with
   * the reason the member gives.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { withdrawExhibit, type ExhibitSetDetail, type ExhibitSetMember } from "./exhibits-api.ts";

  let {
    open = $bindable(false),
    set,
    member,
    onWithdrawn,
  }: {
    open?: boolean;
    set: ExhibitSetDetail;
    member: ExhibitSetMember | null;
    onWithdrawn: () => void;
  } = $props();

  let basis = $state("");
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    basis = "";
    failure = null;
  }

  const refusal = $derived(basis.trim() === "" ? "Give the reason." : undefined);

  async function commit(): Promise<ActionOutcome> {
    if (member === null) return "refused";
    failure = null;
    const outcome = await withdrawExhibit(fetch, set.matterId, set.id, member.id, basis.trim());
    if (outcome.kind === "ok") {
      onWithdrawn();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The exhibit was not withdrawn.",
      "Couldn't connect, so the exhibit stands.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Withdraw Exhibit"
  commitLabel="Withdraw"
  commitBusyLabel="Withdrawing"
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={basis.trim() !== ""}
  onOpen={reset}
  onCommit={commit}
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

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      {#if member !== null}
        <p class="text-sm">
          {member.caption}, {member.title}. It keeps its label and is marked withdrawn.
        </p>
      {/if}
      <LabelledField label="Reason">
        {#snippet children({ props })}
          <Textarea
            {...props}
            rows={3}
            disabled={busy}
            bind:value={basis}
            placeholder={placeholderOf("Withdrawn at the pretrial conference")}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
