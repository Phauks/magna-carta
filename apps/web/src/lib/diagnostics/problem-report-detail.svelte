<script lang="ts">
  /*
   * One problem report, as each of its readers opens it: the firm's admins (who answer it), the
   * member who sent it, and Magna Carta where the firm shares its reports. The words, the
   * screenshot and the redacted context are the same for all three; only an answerer is offered
   * the status and the note.
   */
  import type { IncidentDetail } from "@magna-carta/api-client";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Textarea from "@magna-carta/design-system/textarea";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    PROBLEM_REPORT_STATUSES,
    answerProblemReport,
    problemReportStatusLabel,
    readProblemReportScreenshotUrl,
    type ProblemReportStatus,
    type ScreenshotReader,
  } from "./problem-reports-api.ts";

  let {
    report,
    screenshotReader,
    answerable = false,
    firmName = null,
    onAnswered,
  }: {
    report: IncidentDetail;
    /** Where this reader's copy of the screenshot is served from. */
    screenshotReader: ScreenshotReader;
    /** Whether this reader sets the status and writes the note. */
    answerable?: boolean;
    /** The firm the report came from, where the reader is outside it. */
    firmName?: string | null;
    onAnswered?: (answered: IncidentDetail) => void;
  } = $props();

  const STATUS_OPTIONS = PROBLEM_REPORT_STATUSES.map((status) => ({
    value: status,
    label: problemReportStatusLabel(status),
  }));

  let status = $state<string>("open");
  let note = $state("");
  let saving = $state(false);
  let failure = $state<StatedFailure | null>(null);
  let stepsShown = $state(false);
  let pictureUrl = $state<string | null>(null);

  // A newly opened report starts the answer from what it says now.
  $effect(() => {
    status = report.status;
    note = report.statusNote ?? "";
    failure = null;
    stepsShown = false;
  });

  $effect(() => {
    if (!report.hasScreenshot) {
      pictureUrl = null;
      return;
    }
    let current: string | null = null;
    let cancelled = false;
    void readProblemReportScreenshotUrl(screenshotReader).then((url) => {
      if (cancelled) {
        if (url !== null) URL.revokeObjectURL(url);
        return;
      }
      current = url;
      pictureUrl = url;
    });
    return () => {
      cancelled = true;
      if (current !== null) URL.revokeObjectURL(current);
    };
  });

  const heading = $derived.by(() => {
    const words = (report.description ?? "").trim().split("\n")[0] ?? "";
    return words === "" ? "Problem Report" : words.length > 90 ? `${words.slice(0, 90)}...` : words;
  });

  // The heading already says the first line; the body says the rest, so nothing reads twice.
  const body = $derived.by(() => {
    const words = (report.description ?? "").trim();
    const firstBreak = words.indexOf("\n");
    if (firstBreak === -1) return words.length > 90 ? words : "";
    return words.slice(firstBreak + 1).trim();
  });

  const byline = $derived(
    [firmName, report.reporterName, formatInstant(report.createdAt), report.route]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · "),
  );

  async function save(): Promise<void> {
    saving = true;
    failure = null;
    const outcome = await answerProblemReport(report.id, status as ProblemReportStatus, note);
    saving = false;
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "The answer wasn't saved.");
      return;
    }
    onAnswered?.(outcome.value);
  }
</script>

<article class="flex flex-col gap-16 rounded-lg border border-border-default p-16">
  <header class="flex flex-col gap-4">
    <h3 class="text-base font-semibold break-words text-text-strong">{heading}</h3>
    <p class="text-xs break-words text-text-muted">{byline}</p>
  </header>

  {#if body !== ""}
    <p class="text-sm break-words whitespace-pre-wrap text-text-default">{body}</p>
  {/if}

  {#if report.hasScreenshot}
    {#if pictureUrl === null}
      <p class="text-xs text-text-muted">Opening the screenshot.</p>
    {:else}
      <img
        src={pictureUrl}
        alt="The screen the report was sent from, with private parts covered by the sender"
        class="h-auto w-full rounded-md border border-border-default"
      />
    {/if}
  {/if}

  <DefinitionList.Root>
    <DefinitionList.Row term="Status">
      <Badge variant={report.status === "fixed" ? "success" : report.status === "open" ? "info" : "neutral"}>
        {problemReportStatusLabel(report.status)}
      </Badge>
    </DefinitionList.Row>
    {#if report.statusNote !== null && !answerable}
      <DefinitionList.Row term="Note">
        <span class="break-words whitespace-pre-wrap">{report.statusNote}</span>
      </DefinitionList.Row>
    {/if}
    {#if report.answeredByName !== null}
      <DefinitionList.Row term="Answered By">{report.answeredByName}</DefinitionList.Row>
    {/if}
    {#if report.errorIds.length > 0}
      <DefinitionList.Row term={report.errorIds.length === 1 ? "Error ID" : "Error IDs"}>
        <span class="font-mono text-xs break-all">{report.errorIds.join(", ")}</span>
      </DefinitionList.Row>
    {/if}
    {#if report.appVersion !== null}
      <DefinitionList.Row term="App Version">
        <span class="font-mono text-xs break-all">{report.appVersion}</span>
      </DefinitionList.Row>
    {/if}
    {#if report.breadcrumbs.length > 0}
      <DefinitionList.Row term="Last Steps">
        <span class="flex flex-wrap items-center gap-8">
          {report.breadcrumbs.length}
          {report.breadcrumbs.length === 1 ? "step" : "steps"}
          <Button variant="ghost" size="sm" onclick={() => (stepsShown = !stepsShown)}>
            {stepsShown ? "Hide" : "Show"}
          </Button>
        </span>
      </DefinitionList.Row>
    {/if}
  </DefinitionList.Root>

  {#if stepsShown}
    <ol class="flex flex-col gap-4 rounded-md bg-surface-sunken p-12 font-mono text-xs text-text-muted">
      {#each report.breadcrumbs as crumb, index (index)}
        <li class="break-all">{formatInstant(crumb.at)} · {crumb.action} · {crumb.route}</li>
      {/each}
    </ol>
  {/if}

  {#if answerable}
    <div class="flex flex-col gap-12 border-t border-border-default pt-16">
      <LabelledField necessity="required" label="Status">
        {#snippet children({ props })}
          <ChoicePicker inputId={props.id} label="Status" options={STATUS_OPTIONS} bind:value={status} disabled={saving} />
        {/snippet}
      </LabelledField>
      <LabelledField
        necessity="optional"
        label={report.reporterName === null ? "Note to the Sender" : `Note to ${report.reporterName}`}
        hint="The sender reads it on their report."
      >
        {#snippet children({ props })}
          <Textarea {...props} rows={3} disabled={saving} bind:value={note} />
        {/snippet}
      </LabelledField>
      {#if failure !== null}
        <FailureNotice failure={failure.failure} title="Not Saved" fallback={failure.fallback} />
      {/if}
      <div class="flex justify-end">
        <Button variant="primary" disabled={saving} onclick={() => void save()}>
          {saving ? "Saving" : "Save and Notify"}
        </Button>
      </div>
    </div>
  {/if}
</article>
