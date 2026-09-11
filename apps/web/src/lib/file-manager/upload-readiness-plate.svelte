<script lang="ts">
  /*
   * The upload readiness check, on the File Safety & Scanning page — one button, and the report it
   * comes back with.
   *
   * WHY IT IS HERE AND NOT IN THE UPLOAD DIALOG. When a file fails to reach storage the dialog can
   * say only that storage did not answer, because the write goes from the browser straight to
   * storage and the refusal never passes through the application. The server CAN see why — the
   * bucket, its settings, and whether its credential is honoured are all facts it can check from
   * its side — so the diagnosis lives where a person with the standing to act on it looks, and the
   * dialog's failure line points here. Running it is an act (the settings it owns are re-applied
   * as they are checked), which is why it is a button and not a read on page load.
   *
   * THE REPORT IS READ TOP DOWN. The checks come back in the order the preconditions hold, so the
   * first failure is the cause and anything under it may be a consequence; the walk stops where
   * nothing below can be asked. A check the deployment cannot make is said to be inapplicable
   * rather than shown as holding — the report never claims to have looked at what it did not.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import {
    checkUploadReadiness,
    UPLOAD_READINESS_CHECK_LABELS,
    type UploadReadinessOutcome,
    type UploadReadinessReport,
  } from "./upload-readiness-api.ts";

  let report = $state<UploadReadinessReport | null>(null);
  let failure = $state<Failure | null>(null);
  let running = $state(false);

  async function run(): Promise<void> {
    running = true;
    failure = null;
    const outcome = await checkUploadReadiness(fetch);
    running = false;
    if (outcome.kind === "ok") report = outcome.value;
    else failure = outcome.failure;
  }

  const OUTCOME_LABEL: Record<UploadReadinessOutcome, string> = {
    ok: "Holds",
    applied: "Applied",
    failed: "Failed",
    "not-applicable": "Not applicable",
  };
  const OUTCOME_VARIANT: Record<UploadReadinessOutcome, "success" | "info" | "danger" | "neutral"> =
    { ok: "success", applied: "info", failed: "danger", "not-applicable": "neutral" };
</script>

<div class="flex items-start gap-16 py-12">
  <div class="flex min-w-0 grow flex-col gap-4">
    <p class="text-md">Check that uploads can reach the firm's storage</p>
    <p class="text-sm text-text-muted">
      A file goes from the browser straight to the firm's storage, so when that write is refused
      the upload can only say that storage did not answer. This asks the server to check each thing
      that write depends on, from its side, and to put right the settings it owns.
    </p>
  </div>
  <div class="shrink-0 pt-4">
    <Button variant="secondary" size="sm" disabled={running} onclick={() => void run()}>
      <ListChecks class="size-16" aria-hidden="true" />
      {running ? "Checking" : report === null ? "Check Now" : "Check Again"}
    </Button>
  </div>
</div>

{#if failure !== null}
  <div class="py-12">
    <FailureNotice
      {failure}
      title="The Check Did Not Run"
      fallback="Nothing about the firm's storage was checked or changed."
      whenSilent="Nothing answered, so nothing about the firm's storage was checked or changed."
      onRetry={() => void run()}
    />
  </div>
{/if}

{#if report !== null}
  <div class="flex items-center gap-8 py-12">
    <Badge variant={report.ready ? "success" : "danger"}>
      {report.ready ? "Ready" : "Not ready"}
    </Badge>
    <p class="text-sm text-text-muted">
      {#if report.uploadPath === "direct-to-storage"}
        Files go from the browser straight to storage.
      {:else}
        Files go through the application in this deployment.
      {/if}
      {#if report.bucketName !== null}
        Bucket {report.bucketName}.
      {/if}
    </p>
  </div>
  {#each report.checks as check (check.id)}
    <div class="flex min-w-0 flex-col gap-4 py-12">
      <div class="flex flex-wrap items-center gap-8">
        <Badge variant={OUTCOME_VARIANT[check.outcome]}>{OUTCOME_LABEL[check.outcome]}</Badge>
        <p class="text-md">{UPLOAD_READINESS_CHECK_LABELS[check.id]}</p>
      </div>
      <p class="text-sm text-text-muted">{check.detail}</p>
    </div>
  {/each}
{/if}
