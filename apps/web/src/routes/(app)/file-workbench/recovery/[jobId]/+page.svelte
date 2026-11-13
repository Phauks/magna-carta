<script lang="ts">
  /*
   * A password-recovery job's own screen — where Unlock's Recover control hands off to.
   *
   * ADDRESSED BY THE JOB, NOT BY THE FILE. The file that started this search may already be gone
   * from the workbench by the time an answer arrives; a search that outlives its own input has to
   * live somewhere that does too. This screen carries nothing but the job's id, in the address, so
   * leaving and coming back — even tomorrow — finds the same job exactly where it was left.
   *
   * POLLS WHILE THE JOB IS ACTIVE, and only then: `queued` and `running` keep asking, every other
   * status is where the job stopped and there is nothing further to learn by asking again.
   */
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/state";
  import Copy from "@lucide/svelte/icons/copy";
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Card from "@magna-carta/design-system/card";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Progress from "@magna-carta/design-system/progress";
  import { cancelRecovery, pollRecovery, type RecoveryJobStatus } from "$lib/tools/file-workbench/decryption-api.ts";
  import { formatCandidateCount, presentRecoveryStatus } from "$lib/tools/file-workbench/recovery-status.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { FILE_WORKBENCH_BACK } from "$lib/screen/screen-header.ts";

  const jobId = $derived(page.params.jobId ?? "");

  const POLL_INTERVAL_MS = 3000;

  let loading = $state(true);
  let notFound = $state(false);
  let job = $state<RecoveryJobStatus | null>(null);
  let copied = $state(false);
  let cancelling = $state(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let gone = false;

  const presentation = $derived(job === null ? null : presentRecoveryStatus(job.status, job.tier));

  function stopPolling(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function poll(): Promise<void> {
    const outcome = await pollRecovery(fetch, jobId);
    if (gone) return;
    if (outcome.kind === "ok") {
      job = outcome.value;
      loading = false;
      if (!presentRecoveryStatus(outcome.value.status, outcome.value.tier).active) {
        stopPolling();
      }
      return;
    }
    if (outcome.kind === "problem" && outcome.problem.status === 404) {
      notFound = true;
      loading = false;
      stopPolling();
      return;
    }
    // Any other failure — a dead transport, a fault the server could not describe otherwise — is
    // left for the next tick. A background poll that surfaced every blip as a screen-stopping error
    // would be worse than one that just tries again in three seconds.
    loading = false;
  }

  async function handleCancel(): Promise<void> {
    if (cancelling) return;
    cancelling = true;
    try {
      await cancelRecovery(fetch, jobId);
      await poll();
    } finally {
      cancelling = false;
    }
  }

  async function copyPassword(): Promise<void> {
    const password = job?.result?.password;
    if (password === undefined) return;
    await navigator.clipboard.writeText(password);
    copied = true;
  }

  onMount(() => {
    void poll();
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      gone = true;
      stopPolling();
    };
  });
  onDestroy(() => {
    gone = true;
    stopPolling();
  });
</script>

<svelte:head><title>Password Recovery · Magna Carta</title></svelte:head>

<ScreenHeader title="Password Recovery" back={FILE_WORKBENCH_BACK} class="mb-24" />

<LoadingRegion {loading} failed={false} empty={notFound} label="Reading the recovery job">
  {#snippet emptyState()}
    <EmptyState title="This Recovery Job Could Not Be Found">
      It may belong to someone else, or the link is no longer valid.
    </EmptyState>
  {/snippet}

  {#if job !== null && presentation !== null}
    <Card.Root class="max-w-xl">
      <Card.Header>
        <div class="flex items-center gap-8">
          <Card.Title>{presentation.heading}</Card.Title>
          {#if job.tier === "gpuRequired"}
            <Badge variant="neutral">Needs GPU-tier hardware</Badge>
          {/if}
        </div>
      </Card.Header>
      <Card.Content class="flex flex-col gap-16">
        <p class="text-sm text-text-muted">{presentation.description}</p>

        {#if job.status === "queued" || job.status === "running"}
          {#if job.tier === "cfCapable" && job.progress.shardCount > 0}
            <Progress value={job.progress.shardsDone} max={job.progress.shardCount} />
          {/if}
          <p class="text-xs text-text-muted">{formatCandidateCount(job.progress.candidatesTried)}</p>
          <div>
            <Button variant="secondary" size="sm" onclick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelling" : "Cancel Search"}
            </Button>
          </div>
        {/if}

        {#if job.status === "found" && job.result !== undefined}
          <Alert.Root variant="success">
            <Alert.Description>
              <span class="font-mono text-base">{job.result.password}</span>
            </Alert.Description>
          </Alert.Root>
          <div class="flex items-center gap-8">
            <Button variant="primary" size="sm" onclick={copyPassword}>
              <Copy class="size-16" aria-hidden="true" />
              Copy Password
            </Button>
            {#if copied}
              <span class="text-sm text-text-muted">Copied.</span>
            {/if}
          </div>
          <p class="text-xs text-text-muted">
            Shown only to you, once. Copy it now. It won't show again if you reload, and it's cleared after a while.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}
</LoadingRegion>
