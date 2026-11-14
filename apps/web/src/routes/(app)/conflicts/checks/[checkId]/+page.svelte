<script lang="ts">
  /*
   * One conflicts check, read back — the Record Detail archetype over the firm's append-only log.
   *
   * THE CHECK IS THE RECORD; A RUN IS ONE SEARCH UNDER IT. A check has a number the firm refers to
   * it by and is run as often as the firm needs. The screen shows ONE run at a time — the one the
   * address names, else the latest — so a reader looking at a run from March is never handed
   * September's results.
   *
   * REPORT AND RUNS ARE TWO TABS (owner's ruling, 2026-11-09, after Cloudflare's Workers pages). The
   * run history used to be a column beside the report, taking a third of the screen to hold a list
   * people open once. It is a tab now, and the report has the width.
   *
   * THE REPORT IS THREE COLLAPSIBLE SECTIONS (the same rulings): Details, what was asked for —
   * the parties one per line, then the settings; Status, where each place stands, with its own log,
   * live while the run is in flight and kept afterwards; Results, what surfaced, one card per result
   * saying why and where, filterable, each reviewable from its card.
   *
   * A RUN IN FLIGHT CAN BE STOPPED FROM ITS OWN BADGE. "Running · 31 s" and Cancel are one control
   * in the header, so the one thing a person can do about a running search sits on the word that
   * says it is running. A cancelled run says so in that badge and on the History tab; the report
   * needs no paragraph about it.
   *
   * NOTHING ON THIS PAGE CONCLUDES ANYTHING. A check that surfaced nothing says 0 results; a
   * reviewer's answer to one result says whose conclusion it is and what they reasoned.
   *
   * PRINT AND DOWNLOAD ARE ICON BUTTONS (owner's ruling, 2026-11-09), named for assistive
   * technology and on hover. Both hand over the same sheet; the download is that sheet as a PDF on
   * the member's Downloads shelf.
   */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Popover from "@magna-carta/design-system/popover";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import { toast } from "@magna-carta/design-system/toast";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import Ban from "@lucide/svelte/icons/ban";
  import Check from "@lucide/svelte/icons/check";
  import Circle from "@lucide/svelte/icons/circle";
  import Download from "@lucide/svelte/icons/download";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Activity from "@lucide/svelte/icons/activity";
  import Timer from "@lucide/svelte/icons/timer";
  import Minus from "@lucide/svelte/icons/minus";
  import Printer from "@lucide/svelte/icons/printer";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Square from "@lucide/svelte/icons/square";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import ResultsReview from "$lib/conflicts/results-review.svelte";
  import MatterChoice from "$lib/conflicts/matter-choice.svelte";
  import { checkReportSheet } from "$lib/conflicts/conflicts-report.ts";
  import { downloadReport } from "$lib/conflicts/report-download.ts";
  import { resultCountText } from "$lib/conflicts/check-results.ts";
  import {
    PLACE_STATE_LABELS,
    placeSettingsText,
    statusCaption,
    statusPlaces,
    type PlaceState,
  } from "$lib/conflicts/check-status.ts";
  import type { ChosenMatter } from "$lib/conflicts/check-request.ts";
  import {
    cancelConflictsRun,
    fileConflictsCheckOnMatter,
    readConflictsCheck,
    rerunConflictsCheck,
    runInFlight,
    DISPOSE_CONFLICTS_PERMISSION,
    RUN_CHECK_PERMISSION,
    RUN_POLL_INTERVAL_MILLISECONDS,
    type CheckRead,
    type RunSummary,
  } from "$lib/conflicts/conflicts-api.ts";
  import {
    DIRECTORY_SPECIFICS,
    SEARCH_LOCATIONS,
    runStatusVocabulary,
    strictnessVocabulary,
    triggerVocabulary,
  } from "$lib/conflicts/conflicts-vocabulary.ts";
  import { entityKindText } from "$lib/conflicts/hit-columns.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const checkId = $derived(page.params.checkId ?? "");
  /** The run the address names, or null for the latest. */
  const askedRunId = $derived(page.url.searchParams.get("run"));

  let result = $state<CheckRead | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loading = $state(true);
  let session = $state<SessionBootstrap | null>(null);
  let printOpen = $state(false);
  let downloading = $state(false);
  let rerunning = $state(false);
  let cancelling = $state(false);
  let filing = $state(false);
  let matterToFile = $state<ChosenMatter | null>(null);
  let assignOpen = $state(false);
  let actFailure = $state<StatedFailure | null>(null);
  let entityNames = $state<ReadonlyMap<string, string>>(new Map());
  let tab = $state("report");
  let sections = $state<string[]>(["details", "status", "results"]);
  let openPlaces = $state<ReadonlySet<string>>(new Set(["directory"]));
  /** The clock the Running badge counts from, ticking only while a run is in flight. */
  let now = $state(Date.now());

  async function read(runId: string | null = askedRunId): Promise<void> {
    loading = true;
    const outcome = await readConflictsCheck(fetch, checkId, runId ?? undefined);
    loading = false;
    if (outcome.kind === "ok") {
      result = outcome.value;
      failure = null;
      return;
    }
    result = null;
    failure = stated(
      outcome.failure,
      "The check could not be read.",
      "The check could not be reached.",
    );
  }

  // The read, keyed on the address: a different run is a different read. While the selected run
  // is in flight the read repeats on a cadence, and stops the moment the run settles or the reader
  // leaves; the timer is cleared on every re-key so two cadences never overlap.
  $effect(() => {
    const asked = checkId;
    const askedRun = askedRunId;
    if (asked === "") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      await read(askedRun);
      if (!live) return;
      if (result !== null && runInFlight(result.run)) {
        timer = setTimeout(() => void tick(), RUN_POLL_INTERVAL_MILLISECONDS);
      }
    };
    void tick();
    void firmRoster.load(fetch);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  });

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  const permissions = $derived(session?.permissions ?? null);
  const mayRun = $derived(permissions === null || permissions.includes(RUN_CHECK_PERMISSION));
  const mayReview = $derived(
    permissions === null || permissions.includes(DISPOSE_CONFLICTS_PERMISSION),
  );
  const RUN_REFUSAL = permissionRefusal("Running this check", RUN_CHECK_PERMISSION);
  const REVIEW_REFUSAL = permissionRefusal("Reviewing a result", DISPOSE_CONFLICTS_PERMISSION);

  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );
  const signedInName = $derived(session?.user.name ?? null);
  const check = $derived(result?.check ?? null);
  const run = $derived(result?.run ?? null);
  const record = $derived(result?.record ?? null);
  const inFlight = $derived(run !== null && runInFlight(run));

  // The Running badge counts seconds; the clock ticks only while there is something to count.
  $effect(() => {
    if (!inFlight) return;
    now = Date.now();
    const interval = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(interval);
  });

  /** A member's name, never their account handle. */
  function memberText(userId: string | null): string {
    if (userId === null) return "Nobody — run automatically";
    return personName(memberNames.get(userId) ?? null, {
      whenUnrecorded: "A member the firm's roster does not name",
    });
  }

  function seconds(fromInstant: string | null, toMilliseconds: number): string {
    if (fromInstant === null) return "";
    const elapsed = Math.max(0, Math.round((toMilliseconds - Date.parse(fromInstant)) / 1000));
    if (elapsed < 60) return `${String(elapsed)} s`;
    return `${String(Math.floor(elapsed / 60))} min ${String(elapsed % 60)} s`;
  }

  function tookText(entry: RunSummary): string {
    if (entry.startedAt === null) return "";
    if (entry.finishedAt === null) return runInFlight(entry) ? `${seconds(entry.startedAt, now)} so far` : "";
    return seconds(entry.startedAt, Date.parse(entry.finishedAt));
  }

  /** Show a different run of this check. The address names it, so the read follows. */
  function selectRun(runId: string): void {
    tab = "report";
    void goto(`/conflicts/checks/${encodeURIComponent(checkId)}?run=${encodeURIComponent(runId)}`, {
      keepFocus: true,
      noScroll: true,
    });
  }

  async function runAgain(): Promise<void> {
    if (rerunning || check === null) return;
    rerunning = true;
    actFailure = null;
    const outcome = await rerunConflictsCheck(fetch, check.id, crypto.randomUUID());
    rerunning = false;
    if (outcome.kind !== "ok") {
      actFailure = stated(outcome.failure, "The check could not be run again.");
      return;
    }
    selectRun(outcome.value.runId);
  }

  async function cancelRun(): Promise<void> {
    if (cancelling || check === null || run === null) return;
    cancelling = true;
    actFailure = null;
    const outcome = await cancelConflictsRun(fetch, check.id, run.id, crypto.randomUUID());
    cancelling = false;
    if (outcome.kind !== "ok") {
      actFailure = stated(outcome.failure, "The run could not be cancelled.");
      return;
    }
    if (outcome.value.status === "completed") toast.success("The run had already finished.");
    await read();
  }

  async function fileOnMatter(): Promise<void> {
    if (filing || check === null || matterToFile === null) return;
    filing = true;
    actFailure = null;
    const outcome = await fileConflictsCheckOnMatter(
      fetch,
      check.id,
      matterToFile.id,
      crypto.randomUUID(),
    );
    filing = false;
    if (outcome.kind !== "ok") {
      actFailure = stated(outcome.failure, "The check could not be assigned to that matter.");
      return;
    }
    matterToFile = null;
    assignOpen = false;
    await read();
  }

  const sheet = $derived(
    record === null || check === null || run === null
      ? null
      : checkReportSheet(record, {
          checkNumber: check.checkNumber,
          runOrdinal: run.ordinal,
          entityNames,
          memberNames,
          printedAt: new Date(),
        }),
  );

  async function download(): Promise<void> {
    if (sheet === null || downloading) return;
    downloading = true;
    const outcome = await downloadReport(fetch, sheet);
    downloading = false;
    switch (outcome.kind) {
      case "saved":
        toast.success("Downloaded the report as PDF.");
        return;
      case "shelved":
        toast.success("Added the report to Downloads as PDF.");
        return;
      case "saved-not-kept":
      case "failed":
        toast.error(outcome.message);
    }
  }

  const places = $derived(run === null ? [] : statusPlaces(run, record));
  const askedSources = $derived(new Set(run?.askedScope?.sources ?? []));
  const strictness = $derived(record?.check.strictness ?? run?.askedScope?.strictness ?? null);
  /** Whether names were also found by trigram overlap: the record's word, or the request's while it runs. */
  const trigramMatching = $derived(
    record?.check.matching?.trigramMatching ?? run?.askedScope?.trigramMatching ?? null,
  );
  const hits = $derived(record?.hits ?? []);
  const NO_SHEET = "The report exists once the run has finished.";

  const detailsCaption = $derived.by(() => {
    if (run === null) return "";
    const parties = run.subjectParties.length;
    const searchable = places.filter((place) => place.state !== "not-searched").length;
    return [
      `${String(parties)} ${parties === 1 ? "party" : "parties"}`,
      `${String(searchable)} of ${String(SEARCH_LOCATIONS.length)} locations`,
      strictness === null ? null : strictnessVocabulary(strictness).label,
    ]
      .filter((part) => part !== null)
      .join(" · ");
  });

  const resultsCaption = $derived.by(() => {
    if (run === null) return "";
    if (record !== null) {
      const unreviewed = hits.filter((hit) => hit.disposition === null).length;
      return hits.length === 0
        ? "0 results"
        : `${resultCountText(hits.length)}, ${String(unreviewed)} not reviewed`;
    }
    if (inFlight) return "Results appear as the search finishes";
    return "0 results";
  });

  /** The Directory's options as this run asked for them. */
  const directorySettings = $derived(
    DIRECTORY_SPECIFICS.filter((specific) => askedSources.has(specific.source))
      .map((specific) => specific.label)
      .join(", "),
  );

  const title = $derived(check?.checkNumber ?? "Conflicts Check");
  const runWord = $derived(run === null ? null : runStatusVocabulary(run.status));

  function togglePlace(location: string): void {
    const next = new Set(openPlaces);
    if (next.has(location)) next.delete(location);
    else next.add(location);
    openPlaces = next;
  }
</script>

<svelte:head>
  <title>{title} · Conflicts · Magna Carta</title>
</svelte:head>

{#snippet placeMark(state: PlaceState)}
  {#if state === "done"}
    <Check class="size-16 text-status-success" aria-hidden="true" />
  {:else if state === "searching"}
    <Activity class="size-16 text-status-info" aria-hidden="true" />
  {:else if state === "waiting"}
    <Circle class="size-16 text-text-muted" aria-hidden="true" />
  {:else if state === "stopped"}
    <Ban class="size-16 text-text-muted" aria-hidden="true" />
  {:else if state === "failed"}
    <TriangleAlert class="size-16 text-status-warning" aria-hidden="true" />
  {:else}
    <Minus class="size-16 text-text-muted" aria-hidden="true" />
  {/if}
{/snippet}

<ScreenHeader {title} back="conflicts" class="mb-16">
  {#snippet meta()}
    {#if check !== null && run !== null}
      <span>Opened {formatInstant(check.createdAt)}</span>
      <Masthead.MetaSeparator />
      <span title={triggerVocabulary(run.trigger).meaning}>
        {triggerVocabulary(run.trigger).label}
      </span>
      <Masthead.MetaSeparator />
      <span>{memberText(run.requestedByUserId)}</span>
      <Masthead.MetaSeparator />
      {#if check.matterId !== null}
        <a class="underline underline-offset-2" href="/matters/{check.matterId}/conflicts">
          Filed on a matter
        </a>
      {:else}
        <span>No Matter</span>
      {/if}
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if run !== null && runWord !== null}
      {#if inFlight}
        <!-- The run's state and the one thing to do about it, as one control. -->
        <Button
          variant="secondary"
          disabled={cancelling || !mayRun}
          title={mayRun ? "Cancel this run" : RUN_REFUSAL}
          aria-label="Running for {seconds(run.startedAt ?? run.createdAt, now)}. Cancel run"
          onclick={() => void cancelRun()}
        >
          <Timer class="size-16" aria-hidden="true" />
          {run.status === "queued" ? "Queued" : "Running"} · {seconds(
            run.startedAt ?? run.createdAt,
            now,
          )}
          <span class="ms-8 flex items-center gap-4 border-s border-border-default ps-8">
            <Square class="size-12" aria-hidden="true" />
            {cancelling ? "Cancelling" : "Cancel"}
          </span>
        </Button>
      {:else}
        <Badge variant={runWord.tone} title={runWord.meaning}>
          {run.status === "completed" && run.hitCount !== null
            ? `${runWord.label} · ${resultCountText(run.hitCount)}`
            : runWord.label}
        </Badge>
      {/if}
    {/if}
    {#if check !== null && run !== null && check.matterId === null}
      <!-- Assigning moves no search record; the next run searches with the matter's own parties. -->
      <Popover.Root bind:open={assignOpen}>
        <Popover.Trigger
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={!mayRun}
          title={mayRun ? undefined : RUN_REFUSAL}
        >
          <FolderInput class="size-16" aria-hidden="true" />
          Assign to Matter
        </Popover.Trigger>
        <Popover.Content align="end" class="flex w-sm flex-col gap-8">
          <Label for="assign-to-matter">Assign to Matter</Label>
          <MatterChoice
            subjectEntityIds={run.subjectParties.map((subject) => subject.entityId)}
            value={matterToFile}
            inputId="assign-to-matter"
            disabled={filing}
            placeholder="Matter"
            onpick={(matter) => (matterToFile = matter)}
          />
          <div class="flex justify-end">
            <Button
              disabled={matterToFile === null || filing}
              onclick={() => void fileOnMatter()}
            >
              {filing ? "Assigning" : "Assign"}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Root>
    {/if}
    <Button
      variant="secondary"
      size="icon"
      disabled={sheet === null}
      aria-label="Print Report"
      title={sheet === null ? NO_SHEET : "Print Report"}
      onclick={() => (printOpen = true)}
    >
      <Printer class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="secondary"
      size="icon"
      disabled={sheet === null || downloading}
      aria-label={downloading ? "Downloading Report" : "Download Report"}
      title={sheet === null ? NO_SHEET : "Download Report"}
      onclick={() => void download()}
    >
      <Download class="size-16" aria-hidden="true" />
    </Button>
  {/snippet}
</ScreenHeader>

{#snippet failureNotice()}
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="The Check Could Not Be Read"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
      onRetry={() => void read()}
    />
  {/if}
{/snippet}

{#snippet sectionTrigger(name: string, caption: string)}
  <span class="flex min-w-0 items-baseline gap-12">
    <span class="font-semibold">{name}</span>
    <span class="truncate text-sm text-text-muted">{caption}</span>
  </span>
{/snippet}

<LoadingRegion
  loading={result === null}
  refreshing={loading}
  failed={failure !== null}
  failure={failureNotice}
  label="Reading the check"
  onRetry={() => void read()}
  class="flex flex-col gap-16"
>
  {#snippet fixture()}
    <div class="flex flex-col gap-8">
      {#each ["Details", "Status", "Results"] as heading (heading)}
        <div class="rounded-md border border-border-default p-16">
          <span class="font-semibold" data-loading-keep>{heading}</span>
        </div>
      {/each}
    </div>
  {/snippet}

  {#if result !== null && check !== null && run !== null}
    {#if actFailure !== null}
      <FailureNotice
        failure={actFailure.failure}
        title="Nothing Changed"
        fallback={actFailure.fallback}
        whenSilent={actFailure.whenSilent}
      />
    {/if}

    <Tabs.Root bind:value={tab} class="flex flex-col gap-16">
      <Tabs.List>
        <Tabs.Trigger value="report">Report</Tabs.Trigger>
        <Tabs.Trigger value="history">
          History
          <span class="ms-4 text-text-muted tabular-nums">{String(result.runs.length)}</span>
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="report" class="flex flex-col gap-8">
        {#if result.runs.length > 1}
          <p class="text-sm text-text-muted">
            Showing run {String(run.ordinal)} of {String(result.runs.length)}, started
            {formatInstant(run.startedAt ?? run.createdAt)}.
            <button type="button" class="underline underline-offset-2" onclick={() => (tab = "history")}>
              History
            </button>
          </p>
        {/if}

        <Accordion.Root
      type="multiple"
      value={sections}
      onValueChange={(value: string[]) => (sections = value)} class="flex flex-col gap-8">
          <!-- DETAILS: what was asked for. -->
          <Accordion.Item value="details" class="rounded-md border border-border-default">
            <Accordion.Trigger class="px-16">
              {@render sectionTrigger("Details", detailsCaption)}
            </Accordion.Trigger>
            <Accordion.Content class="flex flex-col gap-16 px-16 pb-16">
              <div class="flex flex-col gap-8">
                <FieldLabel as="h3">Parties</FieldLabel>
                {#if run.subjectParties.length === 0}
                  <p class="text-sm text-text-muted">None named</p>
                {:else}
                  <ul class="flex flex-col gap-4">
                    {#each run.subjectParties as subject (subject.entityId)}
                      <li class="flex items-baseline gap-8 text-sm">
                        <a class="underline-offset-2 hover:underline" href="/directory/{subject.entityId}">
                          {subject.party?.displayName ?? "Unnamed record"}
                        </a>
                        <span class="text-xs text-text-muted">
                          {entityKindText(subject.entityId)}
                        </span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>

              <div class="flex flex-col gap-8 border-t border-border-default pt-16">
                <FieldLabel as="h3">Settings</FieldLabel>
                <DefinitionList.Root>
                  {#each SEARCH_LOCATIONS as entry (entry.location)}
                    <DefinitionList.Row term={entry.label}>
                      {#if entry.location === "directory"}
                        {directorySettings === "" ? "As the firm's floor sets it" : directorySettings}
                      {:else}
                        {placeSettingsText(entry.location, run?.askedScope?.places ?? null) ??
                          "Not searched"}
                      {/if}
                    </DefinitionList.Row>
                  {/each}
                  {#if strictness !== null}
                    <DefinitionList.Row term="Name Matching">
                      {strictnessVocabulary(strictness).label}
                    </DefinitionList.Row>
                  {/if}
                  {#if trigramMatching !== null}
                    <DefinitionList.Row term="Trigram Matching">
                      {trigramMatching ? "On" : "Off"}
                    </DefinitionList.Row>
                  {/if}
                  <DefinitionList.Row term="Asked By">
                    {memberText(run.requestedByUserId)}
                  </DefinitionList.Row>
                  {#if run.status === "cancelled"}
                    <DefinitionList.Row term="Cancelled By">
                      {memberText(run.cancelledByUserId)}
                    </DefinitionList.Row>
                  {/if}
                  <DefinitionList.Row term="Matter">
                    {#if check.matterId !== null}
                      <a class="underline underline-offset-2" href="/matters/{check.matterId}/conflicts">
                        Where the matter stands
                      </a>
                    {:else}
                      No Matter
                    {/if}
                  </DefinitionList.Row>
                </DefinitionList.Root>
              </div>
            </Accordion.Content>
          </Accordion.Item>

          <!-- STATUS: where each place stands, with its own log. -->
          <Accordion.Item value="status" class="rounded-md border border-border-default">
            <Accordion.Trigger class="px-16">
              {@render sectionTrigger("Status", statusCaption(places))}
            </Accordion.Trigger>
            <Accordion.Content class="flex flex-col gap-4 px-16 pb-16">
              <ul class="flex flex-col divide-y divide-border-default">
                {#each places as place (place.location)}
                  {@const hasDetail = place.lines.length > 0 || place.sections.length > 0}
                  {@const placeOpen = openPlaces.has(place.location) && hasDetail}
                  <li class="flex flex-col" data-place={place.location} data-state={place.state}>
                    <button
                      type="button"
                      class="flex items-center gap-12 py-8 text-start text-sm disabled:cursor-default"
                      aria-expanded={hasDetail ? placeOpen : undefined}
                      disabled={!hasDetail}
                      onclick={() => togglePlace(place.location)}
                    >
                      <span role="img" aria-label={PLACE_STATE_LABELS[place.state]}>
                        {@render placeMark(place.state)}
                      </span>
                      <span class="w-96 font-semibold">{place.label}</span>
                      <span class="flex-1 text-text-muted">{place.summary}</span>
                    </button>
                    {#if placeOpen && place.sections.length > 0}
                      <!-- The finished account, one block per row: what each part of the search did,
                           what was not searched (tinted, so a gap stands out from what ran) and what
                           surfaced. -->
                      <div class="flex flex-col gap-8 pb-12 ps-32 text-sm">
                        {#each place.sections as part (part.key)}
                          <section
                            class={[
                              "flex flex-col gap-4 rounded-md p-12",
                              part.attention
                                ? "bg-status-warning-subtle text-status-warning-subtle-foreground"
                                : "bg-surface-sunken",
                            ]}
                            data-section={part.key}
                          >
                            <FieldLabel as="h4">{part.heading}</FieldLabel>
                            {#each part.lines as line, index (`${String(index)}-${line}`)}
                              <p>{line}</p>
                            {/each}
                          </section>
                        {/each}
                      </div>
                    {:else if placeOpen}
                      <ol class="flex flex-col gap-4 pb-12 ps-32 text-sm" aria-live="polite">
                        {#each place.lines as line, index (`${String(index)}-${line}`)}
                          <li>{line}</li>
                        {/each}
                      </ol>
                    {/if}
                  </li>
                {/each}
              </ul>
            </Accordion.Content>
          </Accordion.Item>

          <!-- RESULTS: what surfaced. -->
          <Accordion.Item value="results" class="rounded-md border border-border-default">
            <Accordion.Trigger class="px-16">
              {@render sectionTrigger("Results", resultsCaption)}
            </Accordion.Trigger>
            <Accordion.Content class="px-16 pb-16">
              {#if record !== null}
                <ResultsReview
                  {hits}
                  checkInstant={record.check.createdAt}
                  matterId={check.matterId}
                  {mayReview}
                  reviewRefusal={REVIEW_REFUSAL}
                  {memberNames}
                  memberText={(userId) => memberText(userId)}
                  {signedInName}
                  {permissions}
                  bind:entityNames
                  onRecorded={() => void read()}
                />
              {:else if inFlight}
                <p class="text-sm text-text-muted">The search is running.</p>
              {:else}
                <p class="text-sm">0 results.</p>
              {/if}
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      </Tabs.Content>

      <Tabs.Content value="history" class="flex flex-col gap-16">
        <div class="flex items-center justify-end gap-16">
          <Button
            variant="secondary"
            disabled={rerunning || inFlight || !mayRun}
            title={!mayRun ? RUN_REFUSAL : inFlight ? "A run is already under way." : undefined}
            onclick={() => void runAgain()}
          >
            <RotateCcw class="size-16" aria-hidden="true" />
            {rerunning ? "Opening" : "Run Again"}
          </Button>
        </div>
        <DataTable.Root>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>Run</DataTable.Head>
              <DataTable.Head>Started</DataTable.Head>
              <DataTable.Head>Took</DataTable.Head>
              <DataTable.Head>Asked By</DataTable.Head>
              <DataTable.Head>Results</DataTable.Head>
              <DataTable.Head>State</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each result.runs.toReversed() as entry (entry.id)}
              {@const word = runStatusVocabulary(entry.status)}
              <DataTable.Row aria-current={entry.id === run.id ? "true" : undefined}>
                <DataTable.Cell>
                  <button
                    type="button"
                    class="font-semibold underline-offset-2 hover:underline"
                    onclick={() => selectRun(entry.id)}
                  >
                    Run {String(entry.ordinal)}
                  </button>
                </DataTable.Cell>
                <DataTable.Cell>{formatInstant(entry.startedAt ?? entry.createdAt)}</DataTable.Cell>
                <DataTable.Cell class="tabular-nums">{tookText(entry)}</DataTable.Cell>
                <DataTable.Cell>{memberText(entry.requestedByUserId)}</DataTable.Cell>
                <DataTable.Cell class="tabular-nums">
                  {entry.hitCount === null ? "" : resultCountText(entry.hitCount)}
                </DataTable.Cell>
                <DataTable.Cell>
                  <Badge variant={word.tone} title={word.meaning}>{word.label}</Badge>
                </DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
      </Tabs.Content>
    </Tabs.Root>
  {/if}
</LoadingRegion>

{#if failure === null && record !== null && check !== null}
  {#if sheet !== null}
    <PrintSheet bind:open={printOpen} {sheet} printLabel="Print Report" />
  {/if}
{/if}
