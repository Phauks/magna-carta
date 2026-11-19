<script lang="ts">
  /*
   * Void Next Number: the next number on the account, for a sheet wasted outside Magna Carta (torn
   * in the printer, written on by hand), so the numbers on screen keep matching the paper.
   *
   * THE REASON IS REQUIRED, because a voided number with no reason is the first thing an examiner
   * asks about. An empty reason refuses the commit; the field says nothing, the refusal does.
   *
   * A printed check is not voided here: its row's Return to List does that, in
   * check-return-dialog.svelte, and puts its payment back on To Print.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { TrustChecksService } from "./checks-service.ts";

  let {
    open = $bindable(false),
    trustAccountId,
    checkNumber,
    service,
    onVoided,
  }: {
    open?: boolean;
    trustAccountId: string;
    /** The account's next number, the one being voided. Null while closed. */
    checkNumber: number | null;
    service: TrustChecksService;
    onVoided: () => void;
  } = $props();

  let reason = $state("");
  let submissionKey = "";
  let failure = $state<StatedFailure | null>(null);

  function opened(): void {
    reason = "";
    submissionKey = crypto.randomUUID();
    failure = null;
  }

  const heading = $derived(checkNumber === null ? "Void Next Number" : `Void Check ${checkNumber}`);
  const dialogSubtitle: RecordSubject = { facts: ["The next number, unprinted"] };

  const refusal = $derived(
    checkNumber === null ? "No number is chosen." : reason.trim() === "" ? "Give a reason." : undefined,
  );

  async function commit(): Promise<ActionOutcome> {
    if (checkNumber === null) return "refused";
    failure = null;
    const outcome = await service.voidNextNumber(trustAccountId, reason.trim(), submissionKey);
    if (outcome.kind === "ok") {
      onVoided();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The number was not voided.",
      "Couldn't connect. The number was not voided, and trying again won't void it twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  {heading}
  subtitle={dialogSubtitle}
  commitLabel="Void Check"
  commitBusyLabel="Voiding"
  commitRefusal={refusal}
  unsavedChanges={reason.trim() !== ""}
  onOpen={opened}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Number Was Not Voided"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField necessity="required" label="Reason">
        {#snippet children({ props })}
          <Textarea {...props} rows={3} resizable={false} disabled={busy} bind:value={reason} />
        {/snippet}
      </LabelledField>
      <DefinitionList.Root>
        <DefinitionList.Row term="What Changes">
          The number is kept on the Voided list, and the next check prints on the number after it.
        </DefinitionList.Row>
      </DefinitionList.Root>
    </div>
  {/snippet}
</ActionDialog>
