<script lang="ts">
  /*
   * Settings · My Reports: the problems this member reported, each with where it stands.
   *
   * The notifications say a report arrived and when its status changes; this is where the member
   * reads the whole of it again: their words, their screenshot, the status and any note the person
   * who answered left. Nothing here can be changed.
   */
  import { page } from "$app/state";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    incidentsGetMineOptions,
    incidentsListMineOptions,
    type IncidentSummary,
  } from "@magna-carta/api-client";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { failureOf } from "$lib/api/api-client.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import ProblemReportDetail from "$lib/diagnostics/problem-report-detail.svelte";
  import { problemReportStatusLabel } from "$lib/diagnostics/problem-reports-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  const selectedId = $derived(page.params.incidentId ?? null);

  const listRead = createQuery(() => incidentsListMineOptions());
  const reportRead = createQuery(() => ({
    ...incidentsGetMineOptions({ path: { incidentId: selectedId ?? "" } }),
    enabled: selectedId !== null,
  }));

  const rows = $derived(
    (listRead.data?.incidents ?? []).toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
  );

  function reportAddress(report: IncidentSummary): string {
    return `/settings/my-reports/${encodeURIComponent(report.id)}`;
  }
</script>

<svelte:head>
  <title>My Reports · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead sectionId="my-reports" title="My Reports" posture="readOnly" showHistory={false} />

<SettingsScrollRegion>
  <SettingsDescription>
    The problems you reported from the app, and where each one stands. You're notified when one is
    answered.
  </SettingsDescription>

  <SettingsPlate heading="Reports">
    {#if listRead.isError}
      <FailureNotice
        failure={failureOf(listRead.error)}
        subject="Your reports"
        fallback="Your reports couldn't be read."
        onRetry={() => void listRead.refetch()}
      />
    {:else}
      {#if listRead.isPending}
        <p class="py-8 text-xs text-text-muted">Reading the reports.</p>
      {:else if rows.length === 0}
        <p class="py-8 text-sm text-text-muted">No reports yet.</p>
      {:else}
        <ul class="flex flex-col divide-y divide-border-default" aria-label="The problems you reported">
          {#each rows as report (report.id)}
            <li class="flex flex-col gap-4 py-8" aria-current={report.id === selectedId ? "true" : undefined}>
              <a href={reportAddress(report)} class="break-words underline underline-offset-2">
                {report.summary ?? "Problem report"}
              </a>
              <span class="text-xs text-text-muted">
                {formatInstant(report.createdAt) + " · " + problemReportStatusLabel(report.status)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </SettingsPlate>

  {#if selectedId !== null}
    {#if reportRead.isError}
      <FailureNotice
        failure={failureOf(reportRead.error)}
        subject="The report"
        fallback="The report couldn't be opened."
        onRetry={() => void reportRead.refetch()}
      />
    {:else if reportRead.data !== undefined}
      <ProblemReportDetail
        report={reportRead.data}
        screenshotReader={{ kind: "sender", incidentId: reportRead.data.id }}
      />
    {/if}
  {/if}
</SettingsScrollRegion>
