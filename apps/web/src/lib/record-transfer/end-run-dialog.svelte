<script lang="ts">
  /*
   * Accept Run and Stop Run: the two ways a run ends, each asked once and never undone.
   *
   * Accepting marks the run complete and asks for a conflicts check of each open matter it brought
   * in. Stopping ends the run without accepting it: everything that arrived stays, and no conflicts
   * check is asked for. Either way the run takes no more files or passes.
   *
   * A run cannot end while one of its passes has not. The panel still opens, says so, and holds its
   * commit shut, so the reason is read where the act was asked for.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import type { RecordTransferRun } from "@magna-carta/api-client";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { acceptTransferRun, stopTransferRun } from "./record-transfer-api.ts";

  const PASS_STILL_RUNNING = "A pass is still running. Wait for it to end.";

  let {
    acceptOpen = $bindable(false),
    stopOpen = $bindable(false),
    runId,
    runLabel,
    passInFlight,
    onEnded,
  }: {
    acceptOpen?: boolean;
    stopOpen?: boolean;
    runId: string;
    runLabel: string;
    /** One of the run's passes has not ended, so the run cannot end yet. */
    passInFlight: boolean;
    onEnded: (run: RecordTransferRun) => void;
  } = $props();

  let failure = $state<StatedFailure | null>(null);
  const acceptIntent = new WriteIntent();
  const stopIntent = new WriteIntent();

  function reset(): void {
    failure = null;
  }

  async function accept(): Promise<ActionOutcome> {
    failure = null;
    const { value: outcome } = await acceptIntent.submit((key) => acceptTransferRun(runId, key));
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "The run couldn't be accepted.");
      return "refused";
    }
    onEnded(outcome.value.run);
    return "committed";
  }

  async function stop(): Promise<ActionOutcome> {
    failure = null;
    const { value: outcome } = await stopIntent.submit((key) => stopTransferRun(runId, key));
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "The run couldn't be stopped.");
      return "refused";
    }
    onEnded(outcome.value.run);
    return "committed";
  }
</script>

{#snippet refusal()}
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="Nothing Changed"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
    />
  {/if}
{/snippet}

{#snippet waiting()}
  {#if passInFlight}
    <Alert.Root variant="warning">
      <Alert.Description>{PASS_STILL_RUNNING}</Alert.Description>
    </Alert.Root>
  {/if}
{/snippet}

<ActionDialog
  bind:open={acceptOpen}
  kind="confirm"
  width="narrow"
  heading="Accept Run"
  subtitle={{ facts: [runLabel] }}
  commitLabel="Accept Run"
  commitBusyLabel="Accepting"
  commitRefusal={passInFlight ? PASS_STILL_RUNNING : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={accept}
>
  {#snippet notice()}
    {@render refusal()}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      {@render waiting()}
      <p class="text-sm">
        The run is marked complete. Each open matter it brought in gets a conflicts check. The run
        takes no more files or passes. This can't be undone.
      </p>
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={stopOpen}
  kind="confirm"
  width="narrow"
  heading="Stop Run"
  subtitle={{ facts: [runLabel] }}
  commitLabel="Stop Run"
  commitBusyLabel="Stopping"
  commitRefusal={passInFlight ? PASS_STILL_RUNNING : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={stop}
>
  {#snippet notice()}
    {@render refusal()}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      {@render waiting()}
      <p class="text-sm">
        The run ends without being accepted. Everything that arrived stays, and no conflicts checks
        are run. The run takes no more files or passes. This can't be undone.
      </p>
    </div>
  {/snippet}
</ActionDialog>
