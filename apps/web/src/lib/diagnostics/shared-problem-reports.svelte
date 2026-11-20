<script lang="ts">
  /*
   * The problem reports firms share with Magna Carta, for a platform operator: a list of redacted
   * facts (firm, when, where in the app, status) and, opened one at a time, the report in full.
   * Opening one is an audited read the firm sees in its own record, which is why the words are not
   * on the list.
   */
  import { createQuery } from "@tanstack/svelte-query";
  import {
    platformSharedProblemReportOptions,
    platformSharedProblemReportsOptions,
    type SharedProblemReportSummary,
  } from "@magna-carta/api-client";
  import Button from "@magna-carta/design-system/button";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { failureOf } from "$lib/api/api-client.ts";
  import FailureNotice from "./failure-notice.svelte";
  import ProblemReportDetail from "./problem-report-detail.svelte";
  import { problemReportStatusLabel } from "./problem-reports-api.ts";

  let selected = $state<SharedProblemReportSummary | null>(null);

  const listRead = createQuery(() => platformSharedProblemReportsOptions());
  const reportRead = createQuery(() => ({
    ...platformSharedProblemReportOptions({
      path: { firmId: selected?.firmId ?? "", incidentId: selected?.incidentId ?? "" },
    }),
    enabled: selected !== null,
  }));

  const reports = $derived(listRead.data?.reports ?? []);
</script>

<div class="flex flex-col gap-12">
  <p class="text-xs text-text-muted">
    Reports from firms that send them to Magna Carta. Opening one is recorded in that firm's audit
    log.
  </p>
  {#if listRead.isError}
    <FailureNotice
      failure={failureOf(listRead.error)}
      subject="The shared reports"
      fallback="The shared reports couldn't be read."
      onRetry={() => void listRead.refetch()}
    />
  {:else if listRead.isPending}
    <p class="text-xs text-text-muted">Reading the shared reports.</p>
  {:else if reports.length === 0}
    <p class="text-sm text-text-muted">No firm has sent a report yet.</p>
  {:else}
    <ul class="flex flex-col divide-y divide-border-default">
      {#each reports as report (report.incidentId)}
        <li class="flex flex-wrap items-center justify-between gap-8 py-8">
          <span class="flex min-w-0 flex-col gap-4">
            <span class="text-sm break-words text-text-default">{report.firmName}</span>
            <span class="text-xs break-words text-text-muted">
              {formatInstant(report.sentAt)} · {report.route ?? "No route"} · {problemReportStatusLabel(
                report.status,
              )}
            </span>
          </span>
          <Button variant="secondary" size="sm" onclick={() => (selected = report)}>Open</Button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if selected !== null}
    {#if reportRead.isError}
      <FailureNotice
        failure={failureOf(reportRead.error)}
        subject="The report"
        fallback="The report couldn't be opened. Its firm may have stopped sharing reports."
        onRetry={() => void reportRead.refetch()}
      />
    {:else if reportRead.data !== undefined}
      <ProblemReportDetail
        report={reportRead.data.report}
        firmName={reportRead.data.firmName}
        screenshotReader={{
          kind: "magna-carta",
          firmId: reportRead.data.firmId,
          incidentId: reportRead.data.report.id,
        }}
      />
    {/if}
  {/if}
</div>
