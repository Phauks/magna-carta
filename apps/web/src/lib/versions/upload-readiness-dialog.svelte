<script lang="ts">
  /*
   * The upload readiness report, in full, as a reading panel off the version chip.
   *
   * The chip's File storage row carries the verdict in one line; six checks with a sentence each
   * do not fit a popover, and a person forwarding the fault needs all of them. So the row opens
   * this, and the whole report is one Copy away — the same rule every version on the panel keeps:
   * what is on screen is what goes on the clipboard. Read top down: the checks come back in the
   * order the preconditions hold, so the first failure is the cause and anything under it may be
   * a consequence. A check the deployment could not make is said to be inapplicable rather than
   * shown as holding.
   *
   * A reading panel of the shared action-dialog shell: it asks for nothing and commits nothing;
   * the two controls it carries — copy, and run again — sit in its body beside what they act on.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import ClipboardCopy from "@lucide/svelte/icons/clipboard-copy";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import {
    UPLOAD_READINESS_CHECK_LABELS,
    type UploadReadinessReport,
  } from "$lib/file-manager/upload-readiness-api.ts";
  import {
    copyReportForUploadReadiness,
    UPLOAD_READINESS_OUTCOME_LABELS,
    uploadReadinessOutcomeVariant,
  } from "./upload-readiness-model.ts";

  let {
    open = $bindable(false),
    report,
    running,
    onRerun,
  }: {
    open?: boolean;
    report: UploadReadinessReport;
    running: boolean;
    onRerun: () => void;
  } = $props();

  let copied = $state(false);

  async function copy(): Promise<void> {
    // The confirmation appears only when the clipboard actually took the text; a denied
    // permission is silent rather than a page error, as everywhere else on the panel.
    try {
      await navigator.clipboard.writeText(copyReportForUploadReadiness(report));
    } catch {
      return;
    }
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1000);
  }
</script>

<ActionDialog
  bind:open
  kind="reading"
  heading="Upload Readiness"
  subtitle="Whether a file chosen in a browser can reach the firm's storage, checked from the server. The first line that fails is the cause."
>
  {#snippet fields()}
    <div class="flex flex-wrap items-center gap-8">
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
      <span class="grow"></span>
      <Button variant="secondary" size="sm" disabled={running} onclick={onRerun}>
        <RefreshCw class="size-16" aria-hidden="true" />
        {running ? "Checking" : "Check Again"}
      </Button>
      <Button variant="secondary" size="sm" onclick={() => void copy()}>
        <ClipboardCopy class="size-16" aria-hidden="true" />
        {copied ? "Copied" : "Copy Report"}
      </Button>
    </div>

    <div class="flex flex-col divide-y divide-border-default">
      {#each report.checks as check (check.id)}
        <div class="flex min-w-0 flex-col gap-4 py-8">
          <div class="flex flex-wrap items-center gap-8">
            <Badge variant={uploadReadinessOutcomeVariant(check.outcome)}>
              {UPLOAD_READINESS_OUTCOME_LABELS[check.outcome]}
            </Badge>
            <span class="text-sm text-text-default">{UPLOAD_READINESS_CHECK_LABELS[check.id]}</span>
          </div>
          <p class="text-xs text-text-muted">{check.detail}</p>
        </div>
      {/each}
    </div>
  {/snippet}
</ActionDialog>
