<script lang="ts">
  /*
   * Stop reading a bank. The provider's sign-in ends and the bank's accounts are untied from the
   * books; what the bank already reported stays on the record, and the panel says so before the
   * press, because that is the question a reader has at this moment.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { BankConnection } from "./banking-api.ts";
  import type { BankingService } from "./banking-service.ts";

  let {
    open = $bindable(false),
    connection,
    service,
    onDisconnected,
  }: {
    open?: boolean;
    connection: BankConnection | null;
    service: BankingService;
    onDisconnected: () => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);
  let submissionKey = $state("");

  async function disconnect(): Promise<ActionOutcome> {
    if (connection === null) return "refused";
    failure = null;
    const outcome = await service.disconnect(connection.id, submissionKey);
    if (outcome.kind === "ok") {
      onDisconnected();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The bank is still connected.",
      "Couldn't connect. The bank is still connected.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="destructive"
  heading={`Disconnect ${connection?.institutionName ?? "a Bank"}`}
  subtitle={{ facts: connection === null ? [] : [`Connected by ${connection.connectedBy}`] }}
  commitLabel="Disconnect"
  commitBusyLabel="Disconnecting"
  onOpen={() => {
    failure = null;
    submissionKey = crypto.randomUUID();
  }}
  onCommit={disconnect}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Couldn't Disconnect"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm">
      Magna Carta stops reading this bank and its accounts are no longer tied to the books. What
      the bank already sent stays.
    </p>
  {/snippet}
</ActionDialog>
