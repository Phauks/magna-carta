<script lang="ts">
  /*
   * Settings · Problem Reports: the reports the firm's members send, for whoever answers them.
   *
   * A list of every report, newest first, and below it the report the address names, with its
   * status and the note that goes back to the sender. Answering sends the sender a notification
   * (system.incident.answered) carrying the status, never the note; the note is read on the report.
   *
   * The switch above the list decides whether the firm's reports also reach Magna Carta. It is on
   * by default, because a fault Magna Carta never hears about is one it cannot fix.
   */
  import { page } from "$app/state";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    incidentsGetOptions,
    incidentsGetSharingOptions,
    incidentsGetSharingQueryKey,
    incidentsListOptions,
    incidentsListQueryKey,
    type IncidentDetail,
    type IncidentSummary,
  } from "@magna-carta/api-client";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Switch from "@magna-carta/design-system/switch";
  import { failureOf } from "$lib/api/api-client.ts";
  import { queryClient } from "$lib/api/screen-data.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ProblemReportDetail from "$lib/diagnostics/problem-report-detail.svelte";
  import {
    problemReportStatusLabel,
    setProblemReportSharing,
  } from "$lib/diagnostics/problem-reports-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  const SHARING_DEFINITION: SettingDefinition = {
    id: "problem-reports.share-with-magna-carta",
    sectionId: "problem-reports",
    label: "Send Reports to Magna Carta",
    description:
      "Magna Carta also reads the reports your members send, so it can fix what they find. Turning this off withdraws the reports already sent.",
    kind: "switch",
    defaultValue: true,
    sensitivity: "open",
    audited: true,
  };

  const selectedId = $derived(page.params.incidentId ?? null);

  const listRead = createQuery(() => incidentsListOptions());
  const sharingRead = createQuery(() => incidentsGetSharingOptions());
  const reportRead = createQuery(() => ({
    ...incidentsGetOptions({ path: { incidentId: selectedId ?? "" } }),
    enabled: selectedId !== null,
  }));

  const refused = $derived(listRead.isError && failureOf(listRead.error).problem?.status === 403);
  const rows = $derived(
    (listRead.data?.incidents ?? []).toSorted((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    ),
  );

  let sharingBusy = $state(false);
  let sharingFailure = $state<StatedFailure | null>(null);

  async function setSharing(shares: boolean): Promise<void> {
    sharingBusy = true;
    sharingFailure = null;
    const outcome = await setProblemReportSharing(shares);
    sharingBusy = false;
    if (outcome.kind !== "ok") {
      sharingFailure = stated(outcome.failure, "The setting wasn't changed.");
      return;
    }
    queryClient.setQueryData(incidentsGetSharingQueryKey(), outcome.value);
  }

  function answered(detail: IncidentDetail): void {
    queryClient.setQueryData(
      incidentsGetOptions({ path: { incidentId: detail.id } }).queryKey,
      detail,
    );
    void queryClient.invalidateQueries({ queryKey: incidentsListQueryKey() });
  }

  function reportAddress(report: IncidentSummary): string {
    return `/settings/problem-reports/${encodeURIComponent(report.id)}`;
  }
</script>

<svelte:head>
  <title>Problem Reports · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="problem-reports"
  title="Problem Reports"
  posture={refused ? "readOnly" : "instant"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The problems your firm's members report from the app. Set a status and add a note, and the
    sender is told.
  </SettingsDescription>

  {#if refused}
    <p class="text-sm text-text-muted">
      Your firm's admins read and answer problem reports. Reports you sent are under My Reports.
    </p>
  {:else}
    <SettingsPlate heading="Magna Carta">
      <SettingsRow definition={SHARING_DEFINITION}>
        {#snippet control()}
          <Switch
            bind:checked={
              () => sharingRead.data?.sharesWithMagnaCarta ?? true, (shares) => void setSharing(shares)
            }
            disabled={sharingBusy || sharingRead.isPending}
            aria-label="Send reports to Magna Carta"
          />
        {/snippet}
      </SettingsRow>
      {#if sharingFailure !== null}
        <FailureNotice failure={sharingFailure.failure} fallback={sharingFailure.fallback} />
      {/if}
    </SettingsPlate>

    <SettingsPlate heading="Reports">
      {#if listRead.isError}
        <FailureNotice
          failure={failureOf(listRead.error)}
          subject="The reports"
          fallback="The reports couldn't be read."
          onRetry={() => void listRead.refetch()}
        />
      {:else}
        {#if listRead.isPending}
          <p class="py-8 text-xs text-text-muted">Reading the reports.</p>
        {:else if rows.length === 0}
          <p class="py-8 text-sm text-text-muted">No reports yet.</p>
        {:else}
          <ul class="flex flex-col divide-y divide-border-default" aria-label="The firm's problem reports">
            {#each rows as report (report.id)}
              <li class="flex flex-col gap-4 py-8" aria-current={report.id === selectedId ? "true" : undefined}>
                <a href={reportAddress(report)} class="break-words underline underline-offset-2">
                  {report.summary ?? "Problem report"}
                </a>
                <span class="text-xs text-text-muted">
                  {[report.reporterName, formatInstant(report.createdAt), problemReportStatusLabel(report.status)]
                      .filter((part) => part !== null)
                      .join(" · ")}
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
          screenshotReader={{ kind: "answerer", incidentId: reportRead.data.id }}
          answerable
          onAnswered={answered}
        />
      {/if}
    {/if}
  {/if}
</SettingsScrollRegion>
