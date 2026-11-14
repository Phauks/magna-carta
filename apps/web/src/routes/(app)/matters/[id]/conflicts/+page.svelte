<script lang="ts">
  /*
   * The matter's conflicts section: whether this file was checked, what the check found, and who
   * answered each thing it surfaced.
   *
   * WHY THIS IS A SECTION OF ITS OWN, BESIDE INTAKE RATHER THAN INSIDE IT (owner's ruling,
   * 2026-09-07). Running a check is not one of the intake procedure's steps — it is the act a step
   * ASKS ABOUT, and the record it writes outlives the intake that prompted it. The two are separate
   * destinations in the global sidebar for the same reason they are separate here.
   *
   * IT READS LIKE A CHECK'S OWN REPORT (owner's ruling, 2026-11-14: "revise conflicts screen within
   * a matter considering our recent changes to conflicts checks screen. should try and reutilize
   * components"). Four sections that fold, each with a caption, the way the check's Report tab
   * holds Details, Status and Results. Results lead, and they are the check screen's own cards,
   * filters, result window and answer dialog, so a reviewer answers what the latest check surfaced
   * without leaving the matter. Standing holds the counts and any gap, tinted. Checks is the firm's
   * log narrowed to this matter. Re-checks holds what is owed and Re-check Now.
   *
   * THE HEADER CARRIES THE RUN CONTROL, NOT THIS PAGE. New Check is the matter header's one create
   * control, claimed here while this section is mounted, and it opens the same panel the firm's own
   * conflicts log opens rather than firing a search from a press — a check is a
   * professional-responsibility act and choosing its scope is part of it. Re-check now is a
   * DIFFERENT act and keeps its own control inside the standing panel: it takes no scope, because
   * what runs is the firm's own floor.
   *
   * A SAMPLE MATTER HAS NO FIRM BEHIND IT, so it has no log to read and nothing to record against.
   * It says so rather than showing a matter that has never been checked, which is a different fact
   * and a far more alarming one.
   */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { goto } from "$app/navigation";
  import CheckRegister from "$lib/conflicts/check-register.svelte";
  import MatterStanding from "$lib/conflicts/matter-standing.svelte";
  import NewCheckDialog from "$lib/conflicts/new-check-dialog.svelte";
  import RechecksOwed from "$lib/conflicts/rechecks-owed.svelte";
  import ResultsReview from "$lib/conflicts/results-review.svelte";
  import { resultCountText } from "$lib/conflicts/check-results.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import {
    readConflictsCheck,
    readMatterConflictsPosture,
    recheckMatterConflicts,
    runInFlight,
    DISPOSE_CONFLICTS_PERMISSION,
    READ_CONFLICTS_PERMISSION,
    RUN_CHECK_PERMISSION,
    RUN_POLL_INTERVAL_MILLISECONDS,
    type CheckRead,
    type MatterConflictsPosture,
  } from "$lib/conflicts/conflicts-api.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const matterId = $derived(matter.id);
  const isSample = $derived(matter.source === "sample");

  let posture = $state<MatterConflictsPosture | null>(null);
  let failure = $state<StatedFailure | null>(null);
  let loading = $state(true);
  let session = $state<SessionBootstrap | null>(null);
  let rechecking = $state(false);

  const permissions = $derived(session?.permissions ?? null);
  const mayRead = $derived(permissions === null || permissions.includes(READ_CONFLICTS_PERMISSION));
  const mayRun = $derived(permissions === null || permissions.includes(RUN_CHECK_PERMISSION));
  const mayReview = $derived(
    permissions === null || permissions.includes(DISPOSE_CONFLICTS_PERMISSION),
  );
  const RUN_REFUSAL = permissionRefusal("Running a conflicts check", RUN_CHECK_PERMISSION);
  const REVIEW_REFUSAL = permissionRefusal("Reviewing a result", DISPOSE_CONFLICTS_PERMISSION);

  /**
   * How this matter reads on the check form: its number where it has one. A consultation's
   * tentative number counts — running a check against one is the whole point of taking the
   * consultation, and the number is what the result will be filed under.
   */
  const matterLabel = $derived.by(() => {
    const number = matter.matterNumber ?? matter.consultationNumber;
    return number === null ? matter.title : `${number} · ${matter.title}`;
  });

  /*
   * The header's New Check. It opens the composer rather than running anything: the scope a check
   * runs under is a choice on the record, and a create control that searched on one press would
   * make that choice silently on the reader's behalf.
   */
  let composerOpen = $state(false);

  claimMatterCreate("conflicts", () => ({
    title: "Run a conflicts check for this matter. It adds an entry to the firm's log.",
    refusal: isSample ? SAMPLE_MATTER_REFUSAL : !mayRun ? RUN_REFUSAL : undefined,
    run: () => (composerOpen = true),
  }));

  async function read(): Promise<void> {
    loading = true;
    const outcome = await readMatterConflictsPosture(fetch, matterId);
    loading = false;
    if (outcome.kind === "ok") {
      posture = outcome.value;
      failure = null;
      return;
    }
    posture = null;
    failure = stated(
      outcome.failure,
      "Couldn't load this matter's conflicts status.",
      "Couldn't connect to load this matter's conflicts status.",
    );
  }

  /*
   * The latest check's results, read the way the check's own screen reads them, for the run the
   * standing counts from. A run still in flight is read again on the same cadence the check screen
   * uses, until it settles or the reader leaves.
   */
  let latest = $state<CheckRead | null>(null);
  let latestFailure = $state<StatedFailure | null>(null);
  const latestRunId = $derived(posture?.latestCheck?.id ?? null);

  async function readLatest(runId: string): Promise<void> {
    const outcome = await readConflictsCheck(fetch, runId, runId);
    if (outcome.kind === "ok") {
      latest = outcome.value;
      latestFailure = null;
      return;
    }
    latest = null;
    latestFailure = stated(outcome.failure, "Couldn't load the latest check's results.");
  }

  $effect(() => {
    const runId = latestRunId;
    if (runId === null) {
      latest = null;
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      await readLatest(runId);
      if (!live) return;
      if (latest !== null && runInFlight(latest.run)) {
        timer = setTimeout(() => void tick(), RUN_POLL_INTERVAL_MILLISECONDS);
      }
    };
    void tick();
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  });

  /** An answer was written: the results and the counts both move. */
  function answered(): void {
    if (latestRunId !== null) void readLatest(latestRunId);
    void read();
    rereadLog();
  }

  let rereadLog = $state<() => void>(() => {});

  /*
   * A re-check is a WRITE against the append-only log, so it takes an idempotency key like every
   * other one: a double-press must not leave the firm's record showing two searches where a member
   * asked for one.
   */
  async function recheckNow(): Promise<void> {
    if (rechecking) return;
    rechecking = true;
    const outcome = await recheckMatterConflicts(fetch, matterId, crypto.randomUUID());
    rechecking = false;
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "Couldn't start the re-check.");
      return;
    }
    // Straight to the run, which the check's screen shows as it goes, rather than back to a panel
    // the reader would have to re-read to learn anything. The run is named so the screen opens on
    // this run rather than on whichever the check ran last.
    await goto(
      `/conflicts/checks/${outcome.value.id}?run=${encodeURIComponent(outcome.value.runId)}`,
    );
  }

  $effect(() => {
    const asked = matterId;
    if (asked === "" || isSample) {
      loading = false;
      return;
    }
    void read();
    void firmRoster.load(fetch);
  });

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  /*
   * A deep link into this section names ONE check — the matter's Activity chronology and its search
   * both hand a section `?entry={rowId}`, and here that row is a conflicts check. A check opens as
   * its own record, so the link is honoured by going there rather than by landing the reader on the
   * standing and leaving them to find the check again (entry-from-url.ts states the obligation).
   *
   * It REPLACES this address rather than stacking on it, so Back returns to wherever the reader
   * came from instead of bouncing them through a section that immediately leaves again.
   */
  $effect(() => {
    const asked = entryFromUrl();
    if (asked === null) return;
    void goto(`/conflicts/checks/${encodeURIComponent(asked)}`, { replaceState: true });
  });

  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );
  const signedInName = $derived(session?.user.name ?? null);

  /** A member's name, never their account handle. */
  function memberText(userId: string | null): string {
    if (userId === null) return "Nobody, run automatically";
    return personName(memberNames.get(userId) ?? null, {
      whenUnrecorded: "A staff member no longer on the firm's roster",
    });
  }

  let sections = $state<string[]>(["results", "standing"]);

  const hits = $derived(latest?.hits ?? []);
  const latestInFlight = $derived(latest !== null && runInFlight(latest.run));
  const openCount = $derived(
    (posture?.undisposedByTier ?? []).reduce((total, entry) => total + entry.count, 0),
  );
  const answeredCount = $derived(
    (posture?.dispositionsByKind ?? []).reduce((total, entry) => total + entry.count, 0),
  );
  const latestName = $derived(posture?.latestCheck?.checkNumber ?? "the latest check");

  const resultsCaption = $derived.by(() => {
    const check = posture?.latestCheck ?? null;
    if (check === null) return "";
    const from = `from ${latestName}, ${formatInstant(check.createdAt)}`;
    if (latestInFlight) return `The search is running · ${from}`;
    if (latest === null) return from;
    const unreviewed = hits.filter((hit) => hit.disposition === null).length;
    const count =
      hits.length === 0 ? "0 results" : `${resultCountText(hits.length)}, ${String(unreviewed)} not reviewed`;
    return `${count} · ${from}`;
  });
  const standingCaption = $derived(
    `${String(openCount)} not reviewed · ${String(answeredCount)} answered`,
  );
  const recheckCaption = $derived.by(() => {
    if (posture === null) return "";
    const owed = posture.pendingRecheck.length;
    const owedText = owed === 0 ? "None owed" : `${String(owed)} owed`;
    const scheduled = posture.periodicRescan.enabled
      ? `scheduled every ${String(posture.periodicRescan.intervalDays)} days`
      : "scheduled re-screening off";
    return `${owedText} · ${scheduled}`;
  });

  /*
   * The one line under the section's name: what the record says at a glance, so "was this checked"
   * is answered before anything is opened. It never concludes — a count of candidates nobody has
   * answered is a count, and the word "clear" appears nowhere on this surface.
   */
  const summary = $derived.by(() => {
    if (posture === null) return "";
    const latest = posture.latestCheck;
    if (latest === null) return "No check has been run for this matter yet.";
    const open = posture.undisposedByTier.reduce((total, entry) => total + entry.count, 0);
    return open === 0
      ? "All results from the checks have been reviewed."
      : `${String(open)} ${open === 1 ? "result is" : "results are"} waiting for review.`;
  });
</script>

<svelte:head>
  <title>Conflicts · {matter.title} · Magna Carta</title>
</svelte:head>

{#snippet sectionTrigger(name: string, caption: string)}
  <span class="flex min-w-0 items-baseline gap-12">
    <span class="font-semibold">{name}</span>
    <span class="truncate text-sm text-text-muted">{caption}</span>
  </span>
{/snippet}

<div class="flex flex-col gap-16">
  <div class="flex flex-col gap-4 border-b border-border-strong pb-8">
    <FieldLabel as="h2">Conflicts</FieldLabel>
    {#if summary !== ""}
      <p class="text-sm text-text-muted">{summary}</p>
    {/if}
  </div>

  {#if isSample}
    <EmptyState title="A sample matter has no check record">
      This is a sample matter for previewing screens. It has no checks.
    </EmptyState>
  {:else}
    {#if session !== null && !mayRead}
      <Alert.Root variant="info">
        <Alert.Title>This Account Can't View Conflicts</Alert.Title>
        <Alert.Description>
          {permissionRefusal("Reading a matter's conflicts standing", READ_CONFLICTS_PERMISSION)}
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Couldn't Load Conflicts Status"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
        onRetry={() => void read()}
      />
    {:else}
      <LoadingRegion
        loading={posture === null}
        refreshing={loading}
        empty={posture !== null && posture.neverChecked && posture.pendingRecheck.length === 0}
        label="Reading where this matter stands on conflicts"
        onRetry={() => void read()}
        class="flex flex-col gap-8"
      >
        {#snippet emptyState()}
          <EmptyState title="This Matter Has Never Been Checked">
            No check has been run on this matter yet. Use New Check to run the first one.
          </EmptyState>
        {/snippet}
        {#snippet fixture()}
          {#each ["Results", "Standing", "Checks", "Re-checks"] as heading (heading)}
            <div class="rounded-md border border-border-default p-16">
              <span class="font-semibold" data-loading-keep>{heading}</span>
            </div>
          {/each}
        {/snippet}
        {#if posture !== null}
          <Accordion.Root
            type="multiple"
            value={sections}
            onValueChange={(value: string[]) => (sections = value)}
            class="flex flex-col gap-8"
          >
            {#if posture.latestCheck !== null}
              <!-- RESULTS: what the latest check surfaced, reviewable here. -->
              <Accordion.Item value="results" class="rounded-md border border-border-default">
                <Accordion.Trigger class="px-16">
                  {@render sectionTrigger("Results", resultsCaption)}
                </Accordion.Trigger>
                <Accordion.Content class="flex flex-col gap-12 px-16 pb-16">
                  {#if latestFailure !== null}
                    <FailureNotice
                      failure={latestFailure.failure}
                      title="Couldn't Load Results"
                      fallback={latestFailure.fallback}
                      whenSilent={latestFailure.whenSilent}
                      onRetry={() => latestRunId !== null && void readLatest(latestRunId)}
                    />
                  {:else if latest === null}
                    <p class="text-sm text-text-muted">Reading the results.</p>
                  {:else if latestInFlight}
                    <p class="text-sm text-text-muted">The search is running.</p>
                  {:else if latest.record === null}
                    <p class="text-sm">0 results.</p>
                  {:else}
                    <ResultsReview
                      {hits}
                      checkInstant={latest.record.check.createdAt}
                      matterId={matterId}
                      {mayReview}
                      reviewRefusal={REVIEW_REFUSAL}
                      {memberNames}
                      memberText={(userId) => memberText(userId)}
                      {signedInName}
                      {permissions}
                      onRecorded={answered}
                    />
                  {/if}
                  <p class="text-sm">
                    <a class="underline underline-offset-2" href="/conflicts/checks/{posture.latestCheck.id}">
                      Open {latestName}
                    </a>
                    <span class="text-text-muted">for its full report, history and printout.</span>
                  </p>
                </Accordion.Content>
              </Accordion.Item>

              <!-- STANDING: the counts, and any gap, tinted. -->
              <Accordion.Item value="standing" class="rounded-md border border-border-default">
                <Accordion.Trigger class="px-16">
                  {@render sectionTrigger("Standing", standingCaption)}
                </Accordion.Trigger>
                <Accordion.Content class="px-16 pb-16">
                  <MatterStanding {posture} {memberNames} />
                </Accordion.Content>
              </Accordion.Item>

              <!-- CHECKS: the firm's log, narrowed to this matter. -->
              <Accordion.Item value="checks" class="rounded-md border border-border-default">
                <Accordion.Trigger class="px-16">
                  {@render sectionTrigger("Checks", "All checks on this matter")}
                </Accordion.Trigger>
                <Accordion.Content class="px-16 pb-16">
                  <CheckRegister
                    {matterId}
                    bind:reread={rereadLog}
                    caption="All conflicts checks on this matter"
                    emptyTitle="No Check Is Filed On This Matter"
                    onOpenCheck={(checkId) => void goto(`/conflicts/checks/${checkId}`)}
                  >
                    {#snippet emptyBody()}
                      A check run from the firm's log can be assigned to this matter from its own screen. Use New Check to run one here.
                    {/snippet}
                  </CheckRegister>
                </Accordion.Content>
              </Accordion.Item>
            {/if}

            <!-- RE-CHECKS: what is owed, and asking for one now. -->
            <Accordion.Item value="rechecks" class="rounded-md border border-border-default">
              <Accordion.Trigger class="px-16">
                {@render sectionTrigger("Re-checks", recheckCaption)}
              </Accordion.Trigger>
              <Accordion.Content class="px-16 pb-16">
                <RechecksOwed {posture}>
                  {#snippet action()}
                    <!-- It takes no scope: the firm's own floor is what runs, which is why this is
                         one button rather than a form. -->
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!mayRun || rechecking}
                      title={mayRun ? undefined : RUN_REFUSAL}
                      onclick={() => void recheckNow()}
                    >
                      <RefreshCw class="size-16" aria-hidden="true" />
                      {rechecking ? "Re-checking" : "Re-check Now"}
                    </Button>
                  {/snippet}
                </RechecksOwed>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        {/if}
      </LoadingRegion>
    {/if}
  {/if}
</div>

<!-- The same panel the firm's conflicts log opens, with this matter already named: one form, two
     doors. A sample matter has no firm behind it, so the header's control refuses before this. -->
<NewCheckDialog
  bind:open={composerOpen}
  {matterId}
  {matterLabel}
  matterEngaged={matter.matterNumber !== null}
  {permissions}
  onRan={(checkId) => void goto(`/conflicts/checks/${checkId}`)}
/>
