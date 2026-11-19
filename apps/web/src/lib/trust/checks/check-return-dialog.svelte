<script lang="ts">
  /*
   * Return to List: a printed check that came out wrong, or went wrong later, is voided and its
   * payment goes back to To Print. Every check printed is assumed right until someone says so here.
   *
   * THE CHECK NUMBER STAYS ON THE RECORD, on the Voided list with the reason, because a number is
   * never used twice and a gap in the numbers is the first thing an examiner asks about. Nothing is
   * printed again on its own: the payment waits in To Print with the rest.
   *
   * THE REASON IS REQUIRED AND STARTS AS "Misprinted", the usual one. Emptied, the field turns red
   * and says nothing under itself, and Return to List does nothing until it has a reason.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { TrustChecksService } from "./checks-service.ts";

  /** The reason a check is usually returned for, which the field starts with. */
  const USUAL_REASON = "Misprinted";

  let {
    open = $bindable(false),
    trustAccountId,
    check,
    service,
    onReturned,
  }: {
    open?: boolean;
    trustAccountId: string;
    /** The printed check being returned. Null while closed. */
    check: {
      readonly trustCheckId: string;
      readonly checkNumber: number;
      readonly payee: string;
      readonly amountText: string;
    } | null;
    service: TrustChecksService;
    onReturned: () => void;
  } = $props();

  let reason = $state(USUAL_REASON);
  let submissionKey = "";
  let failure = $state<StatedFailure | null>(null);

  function opened(): void {
    reason = USUAL_REASON;
    submissionKey = crypto.randomUUID();
    failure = null;
  }

  const empty = $derived(reason.trim() === "");

  const subtitle = $derived<RecordSubject>({
    facts:
      check === null
        ? []
        : [`Check ${check.checkNumber}`, check.payee, check.amountText].filter(
            (fact) => fact !== "",
          ),
  });

  async function commit(): Promise<ActionOutcome> {
    if (check === null || empty) return "refused";
    failure = null;
    const outcome = await service.voidCheck(
      trustAccountId,
      check.trustCheckId,
      reason.trim(),
      submissionKey,
    );
    if (outcome.kind === "ok") {
      onReturned();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The check is still on the Printed list.",
      "Couldn't connect. The check is still on the Printed list, and trying again won't void it twice.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Return to List"
  {subtitle}
  commitLabel="Return to List"
  commitBusyLabel="Returning"
  unsavedChanges={false}
  onOpen={opened}
  onCommit={commit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Check Was Not Returned"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <LabelledField
      necessity="required"
      label="Reason"
      error={empty ? "Enter a reason." : undefined}
    >
      {#snippet children({ props })}
        <Input {...props} bind:value={reason} autocomplete="off" disabled={busy} />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
