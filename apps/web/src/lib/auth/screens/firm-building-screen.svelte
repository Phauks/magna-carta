<script lang="ts">
  /*
   * We are building your workspace — the waiting state, and an honest one.
   *
   * PROVISIONING IS NOT INSTANT AND THIS SCREEN DOES NOT PRETEND IT IS. Creating a firm makes a
   * bucket, mints a key, activates the firm and writes the owner's membership, none of which happens
   * inside the request that asked for it (apps/api-worker/src/background/firm-provision-consumer.ts). So the
   * answer to "is it ready" comes from asking again — and the screen NAMES THE STEPS it is waiting
   * on rather than showing a spinner that could mean anything. Each of them leaves its own mark on
   * the firm's record, so the sequence is read from the server rather than guessed at here, and a
   * build that resumes after a crash reports exactly what it has actually done.
   *
   * THE LAST STEP IS THE ONE THAT WAS MISSING. A firm becomes active before the member record
   * mirroring its owner into the firm's own database has landed, and going in during that gap gives
   * somebody a workspace where every screen refuses. So the sequence runs one step past the firm
   * being made, and this screen is what stands in front of that gap.
   *
   * WHICH IS ALSO WHY IT SERVES TWO WAITS. Redeeming an invitation into a firm that has existed for
   * years queues the same member record and leaves the same gap — so the same screen holds that
   * person too, on the one step that is theirs. It says so in its heading rather than telling
   * somebody joining a working firm that their workspace is being built, and the sequence it is
   * handed carries only the steps that belong to them.
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
   * fraction of anything — the steps are of wildly unequal length. A bar drawn at a made-up
   * percentage is a claim about how far along the work is, which is the one thing this screen does
   * not know. A step either has happened or has not, and that is what is shown.
   */
  import Button from "@magna-carta/design-system/button";
  import ProgressSteps, { type ProgressStep } from "@magna-carta/design-system/progress-steps";
  import type { JoinKind } from "../firm-build-progress.ts";
  import AuthPanel from "../auth-panel.svelte";

  let {
    firmName,
    kind = "founding",
    steps,
    onCheckAgain,
    checking = false,
    slow = false,
    stalled = false,
  }: {
    /** The name they asked for, echoed so the wait is attached to the thing being made. */
    firmName?: string;
    /** Which wait this is — it decides the heading, as the caller's sequence decides the steps. */
    kind?: JoinKind;
    /** The sequence, already worded — $lib/auth/firm-build-progress.ts decides what each says. */
    steps: readonly ProgressStep[];
    onCheckAgain: () => void;
    checking?: boolean;
    /**
     * The build has been going longer than one normally takes. Said plainly rather than hidden: a
     * person watching a sequence that has not moved in two minutes already knows, and a screen that
     * will not admit it is the one they stop trusting.
     */
    slow?: boolean;
    /** The build stopped and nothing is retrying it — the one state waiting will not clear. */
    stalled?: boolean;
  } = $props();
</script>

<AuthPanel title={kind === "joining" ? "Joining Your Firm" : "Building Your Workspace"}>
  {#snippet meta()}
    {#if kind === "joining"}
      {#if firmName}Getting you into {firmName}.{:else}Getting you into your firm.{/if}
    {:else if firmName}Setting up {firmName}.{:else}Setting up your firm.{/if}
  {/snippet}

  {#snippet children()}
    <div class="flex flex-col gap-16">
      <ProgressSteps {steps} />

      {#if stalled}
        <p class="text-sm text-text-muted">
          Nothing you have done is lost and nothing needs doing again. Support can restart the step
          that stopped.
        </p>
      {:else if slow}
        <p class="text-sm text-text-muted">
          This is taking longer than usual. It will finish on its own, and this page moves on when it does.
        </p>
      {:else}
        <p class="text-sm text-text-muted">
          This usually takes a moment. The page moves on by itself when it is ready.
        </p>
      {/if}

      <Button
        variant="secondary"
        size="lg"
        class="w-full"
        onclick={onCheckAgain}
        disabled={checking}
      >
        {checking ? "Checking…" : "Check Again"}
      </Button>

      <!--
        The closing line follows the STATE, not just the kind. On a stopped build "your firm keeps
        building" sits directly under a step that says it has stopped, and the two cannot both be
        true — a screen that contradicts itself one line apart is worse than one that says less.
      -->
      <p class="text-sm text-text-muted">
        {#if stalled}
          You can close this page. Nothing further happens until the step is restarted, and signing
          in again brings you back here.
        {:else if kind === "joining"}
          You can close this page. The work keeps going, and signing in again brings you straight to
          your firm.
        {:else}
          You can close this page. Your firm keeps building, and signing in again brings you straight
          to it.
        {/if}
      </p>
    </div>
  {/snippet}
</AuthPanel>
