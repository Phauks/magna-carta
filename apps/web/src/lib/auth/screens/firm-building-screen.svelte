<script lang="ts">
  /*
   * We are building your workspace — the waiting state, and an honest one.
   *
   * PROVISIONING IS NOT INSTANT AND THIS SCREEN DOES NOT PRETEND IT IS. Creating a firm makes a
   * bucket, mints a key and writes the owner's membership, none of which happens inside the request
   * that asked for it (apps/api-worker/src/firm-provision-consumer.ts). So the answer to "is it
   * ready" comes from asking again, and the screen says what it is waiting for rather than showing a
   * spinner that could mean anything.
   *
   * THE WAIT IS A FACT ON THE SERVER, NOT A FLAG HERE. The caller polls the bootstrap, which reports
   * the same thing on any device — so closing the tab and coming back tomorrow lands on this screen
   * if the build is still going, and in the workspace if it finished. Nothing about the wait is
   * remembered in this browser, because a browser that remembers it would offer to build a second
   * firm to somebody who cleared their storage.
   *
   * THERE IS NO CANCEL, because there is nothing to cancel: the work is a committed outbox row that
   * retries until it succeeds. Offering a button that stops nothing would be worse than the wait.
   *
   * AND NO PROGRESS BAR. The design system's Progress is determinate, and nothing here measures a
   * fraction of anything — provisioning is a handful of steps of unequal length. A bar drawn at a
   * made-up percentage is a claim about how far along the work is, which is the one thing this
   * screen does not know.
   */
  import Button from "@magna-carta/design-system/button";
  import AuthPanel from "../auth-panel.svelte";

  let {
    firmName,
    onCheckAgain,
    checking = false,
  }: {
    /** The name they asked for, echoed so the wait is attached to the thing being made. */
    firmName?: string;
    onCheckAgain: () => void;
    checking?: boolean;
  } = $props();
</script>

<AuthPanel title="Building Your Workspace">
  {#snippet meta()}
    {#if firmName}Setting up {firmName}.{:else}Setting up your firm.{/if}
  {/snippet}

  {#snippet children()}
    <div class="flex flex-col gap-16">
      <p class="text-sm text-text-muted">
        This usually takes a moment. The page moves on by itself when it is ready.
      </p>

      <Button
        variant="secondary"
        size="lg"
        class="w-full"
        onclick={onCheckAgain}
        disabled={checking}
      >
        {checking ? "Checking…" : "Check Again"}
      </Button>

      <p class="text-sm text-text-muted">
        You can close this page. Your firm keeps building, and signing in again brings you straight
        to it.
      </p>
    </div>
  {/snippet}
</AuthPanel>
