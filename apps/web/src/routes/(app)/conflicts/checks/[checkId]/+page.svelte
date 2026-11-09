<script lang="ts">
  /*
   * One conflicts check, read back — the Record Detail archetype over the firm's append-only log.
   *
   * THE CHECK IS THE RECORD; A RUN IS ONE SEARCH UNDER IT. A check has a number the firm refers to
   * it by, and it is run as often as the firm needs: the first run is the opening, a re-run is a
   * further run under the same number, and an automatic re-check lands here too. The screen carries
   * that history in one place and shows ONE run at a time — the one the address names, else the
   * latest — so a reader looking at a run from March is never handed September's candidates.
   *
   * INPUT AND OUTPUT ARE TOLD APART AT A GLANCE (owner's ruling, 2026-09-11). What was asked for —
   * the parties, the matter, the scope that ran — sits in one card; what came back — the platform's
   * own account of its search, then the candidates — sits in another. They used to run together as
   * three sections of equal weight, which is how a candidate count comes to be read without the
   * account of the search that produced it, and misread as a verdict.
   *
   * A RUN IN FLIGHT SAYS WHERE IT IS. The search runs after the request that opened it answers, and
   * a search nobody can watch is exactly the one that has to report on itself: the screen reads the
   * run every second until it settles and shows the engine's stages with what each has counted so
   * far, in the engine's own order.
   *
   * NOTHING ON THIS PAGE CONCLUDES ANYTHING. There is no summary line, no aggregate, no tick. A
   * check that surfaced nothing says the search ended; a reviewer's answer to one candidate says
   * whose conclusion it is and what they reasoned.
   *
   * THE REPORT HAS EXACTLY TWO CONTROLS: Print Report and Download Report. Both hand over the same
   * sheet; the download is that sheet rendered as a PDF and kept on the member's Downloads shelf,
   * the way every export on the platform is.
   */
  import * as Card from "@magna-carta/design-system/card";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import ProgressSteps from "@magna-carta/design-system/progress-steps";
  import { toast } from "@magna-carta/design-system/toast";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import Download from "@lucide/svelte/icons/download";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import Printer from "@lucide/svelte/icons/printer";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import DispositionDialog from "$lib/conflicts/disposition-dialog.svelte";
  import HitList from "$lib/conflicts/hit-list.svelte";
  import HitWindow from "$lib/conflicts/hit-window.svelte";
  import MatterChoice from "$lib/conflicts/matter-choice.svelte";
  import ScopeInForce from "$lib/conflicts/scope-in-force.svelte";
  import { checkReportSheet } from "$lib/conflicts/conflicts-report.ts";
  import { downloadReport } from "$lib/conflicts/report-download.ts";
  import { runProgressSteps } from "$lib/conflicts/run-progress.ts";
  import { subjectPartiesText } from "$lib/conflicts/check-columns.ts";
  import type { ChosenMatter } from "$lib/conflicts/check-request.ts";
  import {
    fileConflictsCheckOnMatter,
    readConflictsCheck,
    rerunConflictsCheck,
    runInFlight,
    scopeOfCheck,
    RUN_CHECK_PERMISSION,
    RUN_POLL_INTERVAL_MILLISECONDS,
    type CheckRead,
    type HitDetail,
    type ScopeInForceRecord,
  } from "$lib/conflicts/conflicts-api.ts";
  import {
    runStatusVocabulary,
    triggerVocabulary,
  } from "$lib/conflicts/conflicts-vocabulary.ts";
  import { readDirectoryEntity } from "$lib/directory/directory-api.ts";
  import { directoryEntityName } from "$lib/directory/entity-presentation.ts";
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
  let openHit = $state<HitDetail | null>(null);
  let windowOpen = $state(false);
  let dialogOpen = $state(false);
  let printOpen = $state(false);
  let downloading = $state(false);
  let rerunning = $state(false);
  let filing = $state(false);
  let matterToFile = $state<ChosenMatter | null>(null);
  let actFailure = $state<StatedFailure | null>(null);
  let entityNames = $state<ReadonlyMap<string, string>>(new Map());
  let unnameable = $state<ReadonlySet<string>>(new Set());

  /*
   * The shape the page takes while the check is read: its own cards, over an invented search.
   * Inert and hidden from assistive technology while it stands, so none of it can be quoted as
   * what a search did.
   */
  const STATEMENT_FIXTURE: readonly string[] = [
    "Searched the Directory for 4 subject parties under balanced matching, comparing surnames, given names and dates of birth.",
    "Followed every recorded relationship to closure and reached 31 entities; the longest chain ran 3 relationships.",
    "Prior firm history could not be searched: no corpus is registered for it.",
  ];
  const SCOPE_FIXTURE: ScopeInForceRecord = {
    sources: { party: "searched", graph: "searched", imputation: "unavailable", content: "unavailable" },
    strictness: "balanced",
    depth: 3,
    floorRaised: false,
    matching: null,
    traversal: null,
    candidates: null,
  };

  async function read(runId: string | null = askedRunId): Promise<void> {
    loading = true;
    const outcome = await readConflictsCheck(fetch, checkId, runId ?? undefined);
    loading = false;
    if (outcome.kind === "ok") {
      result = outcome.value;
      failure = null;
      // The open hit is a copy of a row that has just been re-read; re-point it at the fresh one so
      // an answer recorded a moment ago shows on the record the window is holding.
      const held = openHit;
      if (held !== null) openHit = outcome.value.hits.find((hit) => hit.id === held.id) ?? null;
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
  const RUN_REFUSAL = permissionRefusal("Running this check again", RUN_CHECK_PERMISSION);

  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );
  const reviewerName = $derived(
    openHit?.disposition === null || openHit === null
      ? null
      : (memberNames.get(openHit.disposition.reviewerUserId) ?? null),
  );
  const signedInName = $derived(session?.user.name ?? null);
  const check = $derived(result?.check ?? null);
  const run = $derived(result?.run ?? null);
  const record = $derived(result?.record ?? null);
  const inFlight = $derived(run !== null && runInFlight(run));
  const openPartyName = $derived(openHit?.party?.displayName ?? null);
  const openConsentingPartyName = $derived.by((): string | null => {
    const consentingPartyId = openHit?.disposition?.waiver?.givenByEntityId ?? null;
    return consentingPartyId === null ? null : (entityNames.get(consentingPartyId) ?? null);
  });

  function memberText(userId: string | null): string {
    if (userId === null) return "Nobody — run automatically";
    return personName(memberNames.get(userId) ?? null, { whenUnrecorded: userId });
  }

  /** One read, for a waiver's consenting party. What it learns is kept for the rest of the visit. */
  async function nameEntity(entityId: string): Promise<void> {
    if (entityNames.has(entityId) || unnameable.has(entityId)) return;
    const outcome = await readDirectoryEntity(fetch, entityId);
    if (outcome.kind !== "ok") {
      unnameable = new Set([...unnameable, entityId]);
      return;
    }
    entityNames = new Map([...entityNames, [entityId, directoryEntityName(outcome.value)]]);
  }

  function openOne(hit: HitDetail): void {
    openHit = hit;
    windowOpen = true;
    // Only the CONSENTING party still needs a read: a waiver names the entity that consented, which
    // is often not the entity that matched. The matched party came with the hit.
    const consentingPartyId = hit.disposition?.waiver?.givenByEntityId ?? null;
    if (consentingPartyId !== null) void nameEntity(consentingPartyId);
  }

  /** Show a different run of this check. The address names it, so the read follows. */
  function selectRun(runId: string): void {
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
      actFailure = stated(outcome.failure, "The check could not be filed on that matter.");
      return;
    }
    matterToFile = null;
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

  const steps = $derived(run === null ? [] : runProgressSteps(run));
  const title = $derived(check?.checkNumber ?? "Conflicts Check");
</script>

<svelte:head>
  <title>{title} · Conflicts · Magna Carta</title>
</svelte:head>

<ScreenHeader {title} back="conflicts" class="mb-24">
  {#snippet meta()}
    {#if check !== null && run !== null}
      <span>Opened {formatInstant(check.createdAt)}</span>
      <Masthead.MetaSeparator />
      <span>{result?.runs.length === 1 ? "1 run" : `${String(result?.runs.length ?? 0)} runs`}</span>
      <Masthead.MetaSeparator />
      <span title={triggerVocabulary(run.trigger).meaning}>
        {triggerVocabulary(run.trigger).label}
      </span>
      <Masthead.MetaSeparator />
      <span>{memberText(run.requestedByUserId)}</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button
      variant="secondary"
      disabled={sheet === null}
      title={sheet === null ? "The report exists once the run has finished." : undefined}
      onclick={() => (printOpen = true)}
    >
      <Printer class="size-16" aria-hidden="true" />
      Print Report
    </Button>
    <Button
      variant="primary"
      disabled={sheet === null || downloading}
      title={sheet === null ? "The report exists once the run has finished." : undefined}
      onclick={() => void download()}
    >
      <Download class="size-16" aria-hidden="true" />
      {downloading ? "Downloading" : "Download Report"}
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

{#snippet runRow(entry: CheckRead["run"], selected: boolean)}
  {@const word = runStatusVocabulary(entry.status)}
  <li>
    <Button
      variant={selected ? "secondary" : "ghost"}
      class="w-full justify-between"
      aria-current={selected ? "true" : undefined}
      onclick={() => selectRun(entry.id)}
    >
      <span class="flex items-baseline gap-8">
        <span>Run {String(entry.ordinal)}</span>
        <span class="text-xs text-text-muted">{formatInstant(entry.createdAt)}</span>
      </span>
      <span class="flex items-baseline gap-8">
        {#if entry.hitCount !== null}
          <span class="text-xs text-text-muted">
            {entry.hitCount === 1 ? "1 candidate" : `${String(entry.hitCount)} candidates`}
          </span>
        {/if}
        <Badge variant={word.tone} title={word.meaning}>{word.label}</Badge>
      </span>
    </Button>
  </li>
{/snippet}

<LoadingRegion
  loading={result === null}
  refreshing={loading}
  failed={failure !== null}
  failure={failureNotice}
  label="Reading the check"
  onRetry={() => void read()}
  class="flex flex-col gap-24"
>
  {#snippet fixture()}
    <Card.Root>
      <Card.Header>
        <Card.Title data-loading-keep>What Was Asked For</Card.Title>
      </Card.Header>
      <Card.Content>
        <ScopeInForce scope={SCOPE_FIXTURE} />
      </Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header>
        <Card.Title data-loading-keep>What Came Back</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-16">
        <ol class="flex flex-col gap-8 text-sm">
          {#each STATEMENT_FIXTURE as line (line)}
            <li>{line}</li>
          {/each}
        </ol>
        <HitList hits={null} loading onOpen={() => undefined} />
      </Card.Content>
    </Card.Root>
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

    <div class="grid grid-cols-1 gap-24 lg:grid-cols-3">
      <div class="flex min-w-0 flex-col gap-24 lg:col-span-2">
        <!-- INPUT: what was asked for. -->
        <Card.Root>
          <Card.Header>
            <Card.Title>What Was Asked For</Card.Title>
            <Card.Description>
              Run {String(run.ordinal)} of {check.checkNumber}
              {#if run.startedAt !== null}
                , started {formatInstant(run.startedAt)}
              {/if}
            </Card.Description>
          </Card.Header>
          <Card.Content class="flex flex-col gap-16">
            <dl class="flex flex-col gap-4 text-sm">
              <div class="flex items-baseline justify-between gap-16">
                <dt class="text-text-muted">Parties</dt>
                <dd class="text-right">
                  <!-- The run stores who it searches from the moment it is queued, so the names
                       stand here while it runs as well as after. -->
                  {subjectPartiesText(run.subjectParties) ?? "None named"}
                </dd>
              </div>
              <div class="flex items-baseline justify-between gap-16">
                <dt class="text-text-muted">Asked By</dt>
                <dd class="text-right">{memberText(run.requestedByUserId)}</dd>
              </div>
              <div class="flex items-baseline justify-between gap-16">
                <dt class="text-text-muted">Matter</dt>
                <dd class="text-right">
                  {#if check.matterId !== null}
                    <a
                      class="underline underline-offset-2"
                      href="/matters/{check.matterId}/conflicts"
                    >
                      <ScrollText class="me-4 inline size-16" aria-hidden="true" />
                      Where the matter stands
                    </a>
                  {:else}
                    <span class="text-text-muted">No Matter</span>
                  {/if}
                </dd>
              </div>
            </dl>

            {#if check.matterId === null}
              <!-- A check run before there was a matter is the ordinary case, and the moment a
                   matter exists is the moment somebody is looking at this. Filing moves no search
                   record; the next run searches with the matter's own parties. -->
              <div class="flex flex-col gap-8 border-t border-border-default pt-12">
                <Label for="file-on-matter">File on a Matter</Label>
                <div class="flex flex-wrap items-end gap-8">
                  <div class="min-w-0 flex-1">
                    <MatterChoice
                      subjectEntityIds={record?.check.subjectEntityIds ?? []}
                      value={matterToFile}
                      inputId="file-on-matter"
                      disabled={filing || !mayRun}
                      title={mayRun ? undefined : RUN_REFUSAL}
                      placeholder="Matter"
                      onpick={(matter) => (matterToFile = matter)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    disabled={matterToFile === null || filing || !mayRun}
                    title={mayRun ? undefined : RUN_REFUSAL}
                    onclick={() => void fileOnMatter()}
                  >
                    <FolderInput class="size-16" aria-hidden="true" />
                    {filing ? "Filing" : "File"}
                  </Button>
                </div>
              </div>
            {/if}

            {#if record !== null}
              <div class="border-t border-border-default pt-12">
                <ScopeInForce scope={scopeOfCheck(record.check)} />
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <!-- OUTPUT: what came back, or where the run is. -->
        <Card.Root>
          <Card.Header>
            <Card.Title>What Came Back</Card.Title>
            {#if inFlight}
              <Card.Description>
                The search is running. This screen follows it until it finishes.
              </Card.Description>
            {:else if run.status === "failed"}
              <Card.Description>The search stopped before it finished. Nothing was recorded.</Card.Description>
            {/if}
          </Card.Header>
          <Card.Content class="flex flex-col gap-16">
            {#if record === null}
              <ProgressSteps {steps} />
            {:else}
              <section class="flex flex-col gap-8">
                <FieldLabel as="h3">What The Search Did</FieldLabel>
                <!-- The engine's own sentences, in the order it wrote them. Nothing here rewrites or
                     summarizes them: a firm defending its procedure quotes this. -->
                <ol class="flex flex-col gap-8 text-sm">
                  {#each record.statement as line, index (`${String(index)}-${line}`)}
                    <li>{line}</li>
                  {/each}
                </ol>
              </section>
              <div class="border-t border-border-default pt-12">
                <HitList hits={record.hits} {loading} onOpen={openOne} />
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      </div>

      <!-- THE HISTORY: every run of this check, newest first, with the one showing marked. -->
      <Card.Root class="self-start">
        <Card.Header>
          <Card.Title>Runs</Card.Title>
          <Card.Description>Every search run under {check.checkNumber}.</Card.Description>
        </Card.Header>
        <Card.Content>
          <ul class="flex flex-col gap-4">
            {#each result.runs.toReversed() as entry (entry.id)}
              {@render runRow(entry, entry.id === run.id)}
            {/each}
          </ul>
        </Card.Content>
        <Card.Footer>
          <Button
            variant="secondary"
            disabled={rerunning || inFlight || !mayRun}
            title={!mayRun
              ? RUN_REFUSAL
              : inFlight
                ? "A run is already under way."
                : "Search again with this check's parties and settings, as a further run under the same number."}
            onclick={() => void runAgain()}
          >
            <RotateCcw class="size-16" aria-hidden="true" />
            {rerunning ? "Opening" : "Run Again"}
          </Button>
        </Card.Footer>
      </Card.Root>
    </div>
  {/if}
</LoadingRegion>

{#if failure === null && record !== null && check !== null}
  <HitWindow
    bind:open={windowOpen}
    hit={openHit}
    consentingPartyName={openConsentingPartyName}
    {reviewerName}
    checkInstant={record.check.createdAt}
    onAnswer={() => (dialogOpen = true)}
  />

  <DispositionDialog
    bind:open={dialogOpen}
    hit={openHit}
    partyName={openPartyName}
    matterId={check.matterId}
    reviewerName={signedInName}
    permissions={session?.permissions ?? null}
    onRecorded={() => void read()}
  />

  {#if sheet !== null}
    <PrintSheet bind:open={printOpen} {sheet} printLabel="Print Report" />
  {/if}
{/if}
