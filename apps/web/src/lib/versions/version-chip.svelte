<script lang="ts">
  /*
   * The version chip and its overlay — chrome, so it may carry identity quietly (the edges rule).
   * The chip always shows THIS build's own short commit, baked in at build time, so it renders
   * whether or not the API answers; opening it asks GET /api/v1/meta/versions what every other
   * part of the deployment is running.
   *
   * EVERY ROW IS HEADED BY THE CLOUDFLARE WORKER IT REPORTS ON (`magna-carta`, `magna-carta-web`,
   * `magna-carta-scan`, …) and by nothing else: the names arrive from the API's roster, which reads
   * them off the wrangler configs that deploy them, so a row that says "Not reporting" tells the
   * reader exactly which project is silent and no row carries an invented product name.
   *
   * THE PAGE'S OWN BUILD IS NOT A STANDING ROW. It was one, headed "This page", and it duplicated
   * magna-carta-web: that Worker serves the interface, so its commit and timestamps are this page's,
   * said once under a name someone can act on (owner ruling, 2026-08-31 — the reasoning and the
   * fallback rule live on showsPageBuildRow in version-overlay-model.ts). It comes back only where
   * nothing else states this build: signed out, or with the web row silent.
   *
   * THE DEPLOYMENT LIST IS THE WHOLE FLEET. Every dedicated sibling Worker appears, the unbound
   * ones included — a worker missing from the list reads as "everything is listed and healthy",
   * which is worse than an honest "Not deployed" row. The fleet beneath the leading pair folds
   * away and remembers the fold, and a folded heading still counts the Workers that came back
   * without a version, so folding hides rows and never hides a fault.
   *
   * TWO WORKERS SERVE THE APP'S ADDRESS, split by route pattern: `magna-carta-web` serves the
   * interface (this page included) and `magna-carta` answers the API. They deploy separately, so
   * the two are allowed to differ, and the front rows carry a colour-coded sync badge instead of a
   * fixed sentence — success once they match, warning only when the web build is the one behind
   * (apiWebSyncState in version-overlay-model.ts), neutral for any other difference, since
   * differing is a normal state and not every difference is a fault.
   *
   * THE CHIP NOTICES AN UPSTREAM DEPLOY. SvelteKit's version poll (svelte.config.js names each
   * build by its commit) compares the running bundle against what the deployment serving it is
   * publishing now; when a newer bundle is live the chip carries a warning dot and a Reload control
   * appears in the panel header, beside Refresh, where the panel's other gesture already is.
   *
   * THE PANEL HAS TWO SUBJECTS, AND THE SECOND IS THIS FIRM'S OWN DATA. "What is running" and
   * "can I reach my firm's records" are different questions with different remedies, and a member
   * whose screens are refusing needs the second one answered: a newly created firm whose member
   * record has not finished being written reads, on every other screen, as a permission somebody
   * forgot to grant. So the Database section asks GET /api/v1/meta/database-health and lays the
   * causes out separately, over BOTH databases a request touches: for each of them a connection and
   * a schema row, plus this account's standing in the firm's, the firm's file storage in the
   * control plane, and any provisioning still in flight. Every word of that reading lives in
   * database-health-model.ts.
   *
   * BOTH SECTIONS FOLD, AND EACH REMEMBERS ITS OWN FOLD. Deployment and Database are the panel's
   * two subjects and each sits behind a caret; the fleet list keeps its own fold inside Deployment.
   * A shut heading still carries what folding it hides — the count of Workers without a version,
   * the worst reading among the health rows — so folding a section never turns it into a claim of
   * health.
   *
   * NEITHER READ HAPPENS UNTIL THE PANEL IS OPENED. The chip is on every screen in the app, and a
   * standing health poll behind it would be a request on every page load to answer a question
   * nobody has asked yet. The update poll is the one exception, and it is an asset read of this
   * bundle's own origin.
   *
   * TWO SCOPES, ONE COMPONENT. Inside a session (`scope="app"`) the panel reports the whole
   * deployment and both of the databases behind it. On the signed-out surfaces (`scope="public"` — sign in, password reset, the
   * joining screens) it reports the page's own build only: that identifier is already inside the
   * bundle the visitor downloaded, so showing it discloses nothing new, while the aggregate is an
   * authenticated read that a signed-out page must not attempt. The update poll still runs there —
   * the version file is a public asset of the same bundle.
   *
   * Honesty rules the panel keeps:
   * - The build line never comes from the network and the deployment lines never come from
   *   anywhere but the read; a failed read is said out loud with its Error ID, never papered over.
   * - The service observation is briefly cached server-side, so once it is old enough to matter
   *   the header says when it was actually taken.
   * - A row's state stays separate from its name: "not wired here" / "did not answer" / "answering
   *   from a build too old to say" all survive as the row's own sentence.
   * - A re-ask that fails keeps the rows it already had and says they are the older read's, so
   *   nothing on screen is left looking current when it is not.
   * - Every version is copyable: one click puts the part's identifier line on the clipboard.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { sampleInstant } from "@magna-carta/design-system/loading-fixtures";
  import Button from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import Separator from "@magna-carta/design-system/separator";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import VersionSectionHeading from "./version-section-heading.svelte";
  import ClipboardCopy from "@lucide/svelte/icons/clipboard-copy";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import { updated } from "$app/state";
  import { requestJson, type Problem } from "$lib/api/request.ts";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import {
    databaseSectionPills,
    type HealthReading,
    copyLineForDatabaseHealth,
    databaseHealthRows,
    describeProvisioningBacklog,
    healthBadgeVariant,
    DATABASE_SECTION_LABEL,
    DEPLOYMENT_SECTION_LABEL,
    HEALTH_READ_IN_FLIGHT_NOTICE,
    SIGNED_OUT_DATABASE_NOTICE,
    type DatabaseHealthValue,
  } from "$lib/versions/database-health-model.ts";
  import {
    databaseSectionPreference,
    deploymentSectionPreference,
    fleetSectionPreference,
  } from "$lib/versions/version-panel-preferences.svelte.ts";
  import {
    apiWebSyncState,
    copyLineForPart,
    describeObservationAge,
    describeRetainedRows,
    findWebWorkerRow,
    formatVersionTimestamp,
    isRealCommit,
    copyReportForPanel,
    partitionDeploymentRows,
    readsServiceAggregate,
    serviceStateDescription,
    serviceStateLabel,
    showsPageBuildRow,
    deploymentSectionPills,
    workersSectionPills,
    syncStateBadgeVariant,
    syncStateLabel,
    versionChipLabel,
    API_WORKER_UNIT_NAME,
    FLEET_SECTION_LABEL,
    NO_SERVICES_NOTICE,
    PAGE_BUILD_ROW_NAME,
    READ_IN_FLIGHT_NOTICE,
    RELOAD_ACTION_LABEL,
    SIGNED_OUT_ESTATE_NOTICE,
    UPDATE_AVAILABLE_EXPLANATION,
    type MetaVersionsValue,
    type ServiceVersionState,
    type VersionReadPhase,
    type VersionScope,
  } from "$lib/versions/version-overlay-model.ts";

  let { scope = "app" }: { scope?: VersionScope } = $props();

  const readsAggregate = $derived(readsServiceAggregate(scope));

  let open = $state(false);
  let value = $state<MetaVersionsValue | null>(null);
  let failure = $state<{ kind: "problem"; problem: Problem } | { kind: "transport" } | null>(
    null,
  );
  let loading = $state(false);
  let copiedRow = $state<string | null>(null);
  let nowEpochMilliseconds = $state(Date.now());

  // The Database section's own read, kept in its own state beside the version read rather than
  // merged with it. They are two requests to two endpoints, and either can fail while the other
  // answers — a shared failure flag would let a dead health read blank the deployment list, which
  // is the opposite of what a panel opened during an outage is for.
  let healthValue = $state<DatabaseHealthValue | null>(null);
  let healthFailure = $state<{ kind: "problem"; problem: Problem } | { kind: "transport" } | null>(
    null,
  );
  let healthLoading = $state(false);
  let copiedEverything = $state(false);

  const chipLabel = versionChipLabel(BUILD_IDENTITY.commit);
  // Sample words for the loading fixtures: an invented commit and its two timestamps, so a
  // fixture row's detail line is the width a real one is.
  const FIXTURE_COMMIT = "0f3a9c1";
  // Three rows' worth of skeleton, named by nothing real (see the fixture snippets below).
  const FIXTURE_ROW_KEYS = ["a", "b", "c"];
  const FIXTURE_ROW_NAME = "\u2014";
  const FIXTURE_COMMIT_TIME = sampleInstant(1);
  const FIXTURE_BUILD_TIME = sampleInstant(0);
  const webCommitLabel = isRealCommit(BUILD_IDENTITY.commit) ? BUILD_IDENTITY.commit : "dev";

  // True once the version poll has seen a bundle newer than the one this tab is running.
  const updateAvailable = $derived(updated.current);

  async function refresh(options: { fresh?: boolean } = {}): Promise<void> {
    // The update check is a public asset read of this bundle's own origin, so every scope may ask.
    void updated.check();
    // The aggregate guard lives on the call itself, not only on its caller: a signed-out panel has
    // no path to the authenticated aggregate at all, including through Refresh and the failure
    // Retry.
    if (!readsAggregate) return;
    loading = true;
    // The explicit gestures (Refresh, Retry) ask for a fresh probe — a member who pressed the
    // button asked what is running NOW, and a cached answer whose age line keeps climbing reads
    // as a broken button. The automatic on-open read stays on the cached path.
    const outcome = await requestJson<MetaVersionsValue>(
      fetch,
      options.fresh === true ? "/api/v1/meta/versions?fresh=true" : "/api/v1/meta/versions",
    );
    loading = false;
    nowEpochMilliseconds = Date.now();
    if (outcome.kind === "ok") {
      value = outcome.value;
      failure = null;
    } else if (outcome.kind === "problem") {
      // The previous answer stays on screen rather than being blanked, and the failure block below
      // says how old it is. Dropping it would trade a stale row for no row, which is worse: the
      // reader loses the last thing that was true and gains nothing.
      failure = { kind: "problem", problem: outcome.problem };
    } else {
      failure = { kind: "transport" };
    }
  }

  async function refreshHealth(): Promise<void> {
    // Same scope guard as the aggregate, and for the same reason: the health read is authenticated
    // and firm-scoped, so a signed-out panel has no path to it at all.
    if (!readsAggregate) return;
    healthLoading = true;
    const outcome = await requestJson<DatabaseHealthValue>(
      fetch,
      "/api/v1/meta/database-health",
    );
    healthLoading = false;
    if (outcome.kind === "ok") {
      healthValue = outcome.value;
      healthFailure = null;
    } else if (outcome.kind === "problem") {
      // The previous rows stay, on the same terms the deployment rows do — the last thing that was
      // true beats nothing at all — and the failure block below says the read did not land.
      healthFailure = { kind: "problem", problem: outcome.problem };
    } else {
      healthFailure = { kind: "transport" };
    }
  }

  // Every open re-reads (the API's brief cache absorbs the cost of the aggregate; the health read
  // is never cached, because its whole subject is a state that changes while somebody watches it),
  // and while the panel is open a slow tick keeps the observation-age line moving instead of
  // freezing at its first render.
  $effect(() => {
    if (!open || !readsAggregate) return;
    void refresh();
    void refreshHealth();
    const ticker = setInterval(() => {
      nowEpochMilliseconds = Date.now();
    }, 5000);
    return () => clearInterval(ticker);
  });

  const observationAge = $derived(
    value === null ? null : describeObservationAge(value.observedAt, nowEpochMilliseconds),
  );
  // Rows that survived a failed re-ask. They are the older read's, and the failure block says so.
  const retainedRows = $derived(
    failure !== null && value !== null
      ? describeRetainedRows(value.observedAt, nowEpochMilliseconds)
      : null,
  );

  // A retained answer still counts as answered: its web row goes on speaking for this build.
  const readPhase = $derived<VersionReadPhase>(
    value !== null ? "answered" : failure !== null ? "failed" : "pending",
  );
  const webWorkerRow = $derived(value === null ? null : findWebWorkerRow(value.services));
  const showsOwnBuild = $derived(
    showsPageBuildRow({ readsAggregate, read: readPhase, webRow: webWorkerRow }),
  );
  // Whether magna-carta-web is running the same build as magna-carta, and if not, which side is
  // behind — the colour-coded read of the pair the front rows show, in place of a fixed sentence.
  const syncState = $derived(value === null ? null : apiWebSyncState(value.api, webWorkerRow));

  const healthRows = $derived(healthValue === null ? [] : databaseHealthRows(healthValue));
  const provisioningBacklog = $derived(
    healthValue === null ? null : describeProvisioningBacklog(healthValue),
  );
  // The read split the way the panel now shows it: the pair that serves the app's address, and the
  // rest of the fleet. Lifted out of the template because each section's shut heading has to count
  // only the Workers ITS OWN fold hides — Workers is no longer nested inside Deployment, so one
  // count across the whole read would have both headings claiming the same silent Worker.
  const deploymentRows = $derived(value === null ? null : partitionDeploymentRows(value.services));
  // What each shut heading says. One shape for all three (version-overlay-model.ts): a count of what
  // the fold hides, always, and a status pill only where there is one. The count is what makes a
  // quiet heading meaningful — "13 Workers" with nothing beside it is a section reporting health,
  // where an empty heading was a section reporting nothing at all.
  const deploymentPills = $derived(
    deploymentRows === null
      ? []
      : deploymentSectionPills({
          // The parts this section shows: the API, plus the pair that serves the app's address.
          partCount: 1 + deploymentRows.front.length,
          syncState,
        }),
  );
  const workersPills = $derived(
    deploymentRows === null ? [] : workersSectionPills(deploymentRows.rest),
  );
  const databasePills = $derived(healthValue === null ? [] : databaseSectionPills(healthValue));

  // Everything the panel is showing, as one paste. Assembled from the same values the rows render
  // from, so a copy can never disagree with the screen it was taken from.
  async function copyEverything(): Promise<void> {
    const report = copyReportForPanel({
      pageBuild: {
        commit: webCommitLabel,
        commitTime: BUILD_IDENTITY.committedAt,
        buildTime: BUILD_IDENTITY.builtAt,
      },
      versions: value,
      databaseLine: healthValue === null ? null : copyLineForDatabaseHealth(healthValue),
    });
    // Same rule as every other copy here: the confirmation appears only when the clipboard actually
    // took the text, and a denied permission is silent rather than a page error.
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      return;
    }
    copiedEverything = true;
    setTimeout(() => {
      copiedEverything = false;
    }, 1000);
  }


  async function copyPart(
    rowKey: string,
    part: {
      label: string;
      commit: string;
      commitTime: string | null;
      buildTime: string | null;
    },
  ): Promise<void> {
    // The fill appears only when the clipboard actually took the text — a denied clipboard
    // permission must not claim a copy that never happened (and must not surface as a page error).
    try {
      await navigator.clipboard.writeText(copyLineForPart(part));
    } catch {
      return;
    }
    copiedRow = rowKey;
    setTimeout(() => {
      if (copiedRow === rowKey) copiedRow = null;
    }, 1000);
  }

  function badgeVariantFor(state: ServiceVersionState): "neutral" | "warning" {
    return state === "unreachable" ? "warning" : "neutral";
  }

  function metaLineFor(commitTime: string | null, buildTime: string | null): string | null {
    const committed = formatVersionTimestamp(commitTime);
    const built = formatVersionTimestamp(buildTime);
    const segments: string[] = [];
    if (committed !== null) segments.push(`committed ${committed}`);
    if (built !== null) segments.push(`built ${built}`);
    return segments.length === 0 ? null : segments.join(" · ");
  }
</script>


{#snippet healthRow(row: {
  name: string;
  reading: HealthReading;
  status: string;
  detail: string;
})}
  <!-- The same two-part shape the deployment rows use: the thing on the left, its state on the
       right, and the sentence beneath the name saying what that state means. A health row is prose
       about this firm rather than a dashboard identity, so no monospace. -->
  <div class="flex items-start justify-between gap-8 py-4">
    <div class="flex min-w-0 flex-col">
      <span class="text-sm text-text-default">{row.name}</span>
      <span class="text-xs text-text-muted">{row.detail}</span>
    </div>
    <Badge class="shrink-0" variant={healthBadgeVariant(row.reading)}>{row.status}</Badge>
  </div>
{/snippet}

{#snippet partRow(part: {
  rowKey: string;
  name: string;
  isWorkerName: boolean;
  state: ServiceVersionState;
  commit: string | null;
  commitTime: string | null;
  buildTime: string | null;
})}
  <!-- One detail line: the timestamps when the row reported, otherwise the sentence naming which
       silence it is in — the part that separates "this deployment has no such worker" from "it is
       not answering" from "it answers, but its build predates the question", three facts the
       badges alone read as one outage. -->
  {@const detail = metaLineFor(part.commitTime, part.buildTime) ?? serviceStateDescription(part.state)}
  {@const stateLabel = serviceStateLabel(part.state)}
  <div class="flex items-center justify-between gap-8 py-4">
    <div class="flex min-w-0 flex-col">
      <!-- Monospace marks an identifier — a deployed Worker's name. The build line is prose about
           this tab, not a dashboard identity, so it stays in the text face. -->
      <span
        class={part.isWorkerName
          ? "font-mono text-sm text-text-default"
          : "text-sm text-text-default"}>{part.name}</span
      >
      {#if detail !== null}
        <span class="text-xs text-text-muted">{detail}</span>
      {/if}
    </div>
    {#if part.state === "reported" && part.commit !== null}
      <!-- The copied confirmation is the control filling in for a moment, not a glyph appearing
           beside the identifier: a check pushed the commit sideways every time it was copied, and
           the width change read as the value itself changing (owner ruling, 2026-08-31). The
           aria-label keeps stating the action for a screen reader.

           The fill is the step BEYOND ghost's own hover (which is --mc-action-secondary): whoever
           just clicked this is by definition hovering it, so a confirmation painted in the hover
           colour is no confirmation at all. -->
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0 font-mono text-xs tabular-nums {copiedRow === part.rowKey
          ? 'bg-action-secondary-hover'
          : ''}"
        aria-label="Copy the {part.name} version"
        onclick={() =>
          copyPart(part.rowKey, {
            label: part.name,
            commit: part.commit ?? "",
            commitTime: part.commitTime,
            buildTime: part.buildTime,
          })}
      >
        {part.commit}
      </Button>
    {:else if stateLabel !== null}
      <Badge variant={badgeVariantFor(part.state)}>{stateLabel}</Badge>
    {/if}
  </div>
{/snippet}

<Popover.Root bind:open>
  <!-- The hover names the control — "Build Information", the same one-name answer the bell, the
       Time Sheet's handle and the download tray give. The chip already shows the build; what the
       hover has to say is what pressing it opens. The tooltip and the popover share ONE button
       through the tooltip trigger's child snippet; the accessible name keeps the build itself,
       which a reader who cannot see the chip has no other way to hear. -->
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Popover.Trigger
          {...props}
          class="mc-top-bar-icon-button gap-8 border text-xs tabular-nums"
          style="border-color: var(--mc-chrome-border)"
          aria-label="Build Information: {chipLabel}{updateAvailable ? ' (update available)' : ''}"
        >
          <GitCommitHorizontal class="size-16" aria-hidden="true" />
          <span class="font-mono">{chipLabel}</span>
          {#if updateAvailable}
            <!-- The quiet signal that a newer deployment is live; the panel carries the words. -->
            <span
              class="size-8 shrink-0 rounded-full"
              style="background-color: var(--mc-status-warning)"
              aria-hidden="true"
            ></span>
          {/if}
        </Popover.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>Build Information</Tooltip.Content>
  </Tooltip.Root>
  <!-- Sizing rides inline style, not a recipe: the max-height ceiling is the Bits-provided
       available viewport height (the same pattern the select listbox uses), so a short window
       scrolls the panel instead of clipping the service rows off-screen. -->
  <Popover.Content
    align="end"
    class="mc-scrollbar flex flex-col gap-8 overflow-y-auto"
    style="inline-size: var(--mc-size-prose); max-height: var(--bits-floating-available-height)"
  >
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-8">
        <p class="text-sm font-medium">Build Versions</p>
        <div class="flex items-center gap-4">
          {#if updateAvailable}
            <!-- The one reload gesture, seated beside Refresh because the two are the panel's
                 only actions and a reader looking for either looks here. It is warning-tinted so
                 it reads as the answer to the chip's dot rather than as a second refresh. -->
            <Button
              variant="ghost"
              size="icon"
              class="shrink-0 text-status-warning"
              aria-label={RELOAD_ACTION_LABEL}
              onclick={() => location.reload()}
            >
              <RotateCw class="size-16" aria-hidden="true" />
            </Button>
          {/if}
          {#if readsAggregate}
            <!-- AT THE TOP, and it takes the WHOLE panel. Both of those were wrong before: the
                 only copy control sat at the foot of the Database section and put four health rows
                 on the clipboard, so a member reporting a fault pasted the database's state and
                 nothing about which build was serving it — the one fact that says whether a fix has
                 shipped yet. A reader reaches for Copy when they open the panel, not after
                 scrolling past everything they wanted copied. -->
            <Button
              variant="ghost"
              size="icon"
              class="shrink-0 {copiedEverything ? 'bg-action-secondary-hover' : ''}"
              aria-label="Copy the whole diagnosis"
              onclick={() => void copyEverything()}
            >
              <ClipboardCopy class="size-16" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="shrink-0"
              aria-label="Refresh the panel"
              disabled={loading || healthLoading}
              onclick={() => {
                void refresh({ fresh: true });
                void refreshHealth();
              }}
            >
              <RefreshCw class="size-16" aria-hidden="true" />
            </Button>
          {/if}
        </div>
      </div>
      <!-- Under the header, not beside it: the age line grows and shrinks as the clock ticks, and
           on the header row that motion pushed the controls around (owner ruling, 2026-08-31). The
           in-flight word takes the same seat, so a re-ask is visible before its answer lands
           without a spinner and without moving anything. The line itself is never conditionally
           mounted — a read that lands inside the fresh window (no age line yet) or ends "Checking
           services" would otherwise make this row appear and disappear as the clock ticks past ten
           seconds, resizing the popover under the reader's eye (owner ruling, 2026-08-31); an
           empty line holds the same height so the panel's size never depends on wording. -->
      {#if readsAggregate}
        <p class="text-xs text-text-muted">
          {#if loading}
            {READ_IN_FLIGHT_NOTICE}
          {:else if healthLoading}
            {HEALTH_READ_IN_FLIGHT_NOTICE}
          {:else if observationAge !== null}
            Services {observationAge}
          {:else}
            &nbsp;
          {/if}
        </p>
      {/if}
    </div>

    {#if failure !== null}
      <div class="flex flex-col gap-4">
        <p class="text-sm text-text-default">
          {failure.kind === "problem"
            ? "The version read failed."
            : "The API could not be reached."}
        </p>
        {#if retainedRows !== null}
          <p class="text-xs text-text-muted">{retainedRows}</p>
        {/if}
        {#if failure.kind === "problem"}
          <p class="text-xs text-text-muted">
            Error ID: {failure.problem.errorId ?? "not yet assigned"} · status {failure.problem
              .status}
          </p>
        {/if}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onclick={() => refresh({ fresh: true })}
          >
            Retry
          </Button>
        </div>
      </div>
    {/if}

    {#if updateAvailable}
      <!-- The words behind the header's Reload control and the chip's dot: the version poll saw a
           newer bundle where this page came from. This is a different question from the sync
           badge below (this build against the deployment serving it, not the API against
           magna-carta-web), so the two can disagree without contradicting each other. -->
      <div class="flex items-center justify-between gap-8">
        <Badge variant="warning">Update Available</Badge>
        <p class="text-xs text-text-muted">{UPDATE_AVAILABLE_EXPLANATION}</p>
      </div>
    {/if}

    {#if showsOwnBuild}
      <!-- The build line, which appears only when no reporting magna-carta-web row is there to
           state the same commit under the name someone can act on. -->
      {@render partRow({
        rowKey: "page",
        name: PAGE_BUILD_ROW_NAME,
        isWorkerName: false,
        state: "reported",
        commit: webCommitLabel,
        commitTime: BUILD_IDENTITY.committedAt,
        buildTime: BUILD_IDENTITY.builtAt,
      })}
    {/if}

    {#if readsAggregate}
      {#if value !== null || loading}
        <Separator />
        <!-- Deployment folds like the fleet inside it. Shut, it wears the count of Workers without
             a version across the WHOLE read, not just the fleet — collapsing this heading takes the
             leading pair down with it, and a fault in the pair is the one most worth seeing. -->
        <VersionSectionHeading
            label={DEPLOYMENT_SECTION_LABEL}
            collapsed={deploymentSectionPreference.collapsed}
            toggle={() => deploymentSectionPreference.toggle()}
            pills={deploymentPills}
          />
        {#if deploymentSectionPreference.collapsed}
          <!-- Nothing: the heading above carries what the fold hides. -->
        {:else}
          <!-- A re-ask keeps the rows in view and marks the region busy; the header's own line
               above says which read is out. -->
          <LoadingRegion
            loading={value === null}
            refreshing={loading}
            label="Reading what the deployment is running"
            onRetry={() => void refresh({ fresh: true })}
            class="flex flex-col gap-8"
          >
            {#snippet fixture()}
              <!-- Row shapes over sample identifiers, greyed. The names are placeholders on purpose:
                   the API's roster is the one home for what the fleet contains, and a skeleton that
                   spelled real Worker names would be this component asserting which Workers exist
                   before the read has said — and would keep asserting it if one were ever renamed. -->
              <div class="flex flex-col">
                {#each FIXTURE_ROW_KEYS as fixtureKey (fixtureKey)}
                  {@render partRow({
                    rowKey: `fixture-${fixtureKey}`,
                    name: FIXTURE_ROW_NAME,
                    isWorkerName: true,
                    state: "reported",
                    commit: FIXTURE_COMMIT,
                    commitTime: FIXTURE_COMMIT_TIME,
                    buildTime: FIXTURE_BUILD_TIME,
                  })}
                {/each}
              </div>
            {/snippet}
            {#if value !== null}
              {@render partRow({
                rowKey: "api",
                name: API_WORKER_UNIT_NAME,
                isWorkerName: true,
                state: "reported",
                commit: isRealCommit(value.api.commit) ? value.api.commit : "dev",
                commitTime: value.api.commitTime,
                buildTime: value.api.buildTime,
              })}
              {#if value.services.length === 0}
                <p class="text-xs text-text-muted">{NO_SERVICES_NOTICE}</p>
              {:else if deploymentRows !== null}
                <!-- The two Workers that serve the app's address, with the sync read that compares
                     them. The rest of the fleet is its own section below, not a fold within this
                     one. -->
                <div class="flex flex-col">
                  {#each deploymentRows.front as service (service.id)}
                    {@render partRow({
                      rowKey: service.id,
                      name: service.service,
                      isWorkerName: true,
                      state: service.state,
                      commit: service.commit,
                      commitTime: service.commitTime,
                      buildTime: service.buildTime,
                    })}
                  {/each}
                </div>
                {#if syncState !== null}
                  <!-- The pair's sync read, colour-coded: success once magna-carta-web matches the
                       API it serves, warning only when the web build is the one behind (the
                       actionable case), neutral for any other difference — the two Workers deploy
                       separately, so differing is a normal state, not a fault. -->
                  <div class="flex items-center gap-8">
                    <Badge variant={syncStateBadgeVariant(syncState)}>{syncStateLabel(syncState)}</Badge>
                  </div>
                {/if}
              {/if}
            {/if}
          </LoadingRegion>
        {/if}
        {#if deploymentRows === null || deploymentRows.rest.length > 0}
          <Separator />
          <!-- WORKERS IS ITS OWN SUBJECT, not a drawer inside Deployment. Nesting it made the fleet
               something a reader reached THROUGH the deployment, when in practice the two are asked
               about separately: "what build is live" and "is anything not answering" are different
               questions, and one of them was two folds deep. Shut, this heading counts only the
               Workers it hides; the pair above it is on screen and speaks for itself. -->
          <VersionSectionHeading
            label={FLEET_SECTION_LABEL}
            collapsed={fleetSectionPreference.collapsed}
            toggle={() => fleetSectionPreference.toggle()}
            pills={workersPills}
          />
          {#if !fleetSectionPreference.collapsed}
            <LoadingRegion
              loading={value === null}
              refreshing={loading}
              label="Reading which Workers are running"
              onRetry={() => void refresh({ fresh: true })}
              class="flex flex-col gap-8"
            >
              {#snippet fixture()}
                <div class="flex flex-col">
                  {#each FIXTURE_ROW_KEYS as fixtureKey (fixtureKey)}
                    {@render partRow({
                      rowKey: `fixture-worker-${fixtureKey}`,
                      name: FIXTURE_ROW_NAME,
                      isWorkerName: true,
                      state: "reported",
                      commit: FIXTURE_COMMIT,
                      commitTime: FIXTURE_COMMIT_TIME,
                      buildTime: FIXTURE_BUILD_TIME,
                    })}
                  {/each}
                </div>
              {/snippet}
              {#if deploymentRows !== null}
                <div class="flex flex-col">
                  {#each deploymentRows.rest as service (service.id)}
                    {@render partRow({
                      rowKey: service.id,
                      name: service.service,
                      isWorkerName: true,
                      state: service.state,
                      commit: service.commit,
                      commitTime: service.commitTime,
                      buildTime: service.buildTime,
                    })}
                  {/each}
                </div>
              {/if}
            </LoadingRegion>
          {/if}
        {/if}
      {/if}
      <Separator />
      <!-- The panel's second subject: whether this session can reach and use its data — in BOTH
           databases a request touches, the control plane that resolves the caller and the firm's own
           that holds their work, each with the same two rows so the reader can say which of the two
           is the slow or broken one. It folds on the same terms Deployment does, and a shut heading
           wears the worst reading in the section, so the one state this whole section exists to
           surface — a membership that has not landed, and every screen refusing because of it —
           survives being folded away. -->
      <VersionSectionHeading
            label={DATABASE_SECTION_LABEL}
            collapsed={databaseSectionPreference.collapsed}
            toggle={() => databaseSectionPreference.toggle()}
            pills={databasePills}
          />
      {#if !databaseSectionPreference.collapsed}
        {#if healthFailure !== null}
          <div class="flex flex-col gap-4">
            <p class="text-sm text-text-default">
              {healthFailure.kind === "problem"
                ? "The database health read failed."
                : "The API could not be reached."}
            </p>
            {#if healthFailure.kind === "problem"}
              <p class="text-xs text-text-muted">
                Error ID: {healthFailure.problem.errorId ?? "not yet assigned"} · status {healthFailure
                  .problem.status}
              </p>
            {/if}
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={healthLoading}
                onclick={() => refreshHealth()}
              >
                Retry
              </Button>
            </div>
          </div>
        {/if}
        {#if healthValue !== null || healthLoading}
          <LoadingRegion
            loading={healthValue === null}
            refreshing={healthLoading}
            label="Reading whether both databases behind this session can be reached"
            onRetry={() => void refreshHealth()}
            class="flex flex-col gap-8"
          >
            {#snippet fixture()}
              <!-- Two health rows over sample readings: the section's own shape, greyed. One per
                   database, so the greyed shape says what is about to arrive. -->
              <div class="flex flex-col">
                {@render healthRow({
                  name: "Firm database",
                  reading: "healthy",
                  status: "Reachable",
                  detail: "The firm's own database answered.",
                })}
                {@render healthRow({
                  name: "Magna Carta database",
                  reading: "healthy",
                  status: "Reachable",
                  detail: "Magna Carta's own database answered.",
                })}
              </div>
            {/snippet}
            {#if healthValue !== null}
              <div class="flex flex-col">
                {#each healthRows as row (row.id)}
                  {@render healthRow(row)}
                {/each}
              </div>
              {#if provisioningBacklog !== null}
                <!-- The membership row's explanation, said only when there is one. A firm whose mirrors
                     have all landed carries nothing here: "0 pending" is an info line with nothing
                     behind it, and this line exists to turn an unexplained refusal into a wait. -->
                <div class="flex items-center gap-8">
                  <Badge variant={healthBadgeVariant(provisioningBacklog.reading)}>Provisioning</Badge>
                  <p class="text-xs text-text-muted">{provisioningBacklog.sentence}</p>
                </div>
              {/if}
            {/if}
          </LoadingRegion>
        {/if}
      {/if}
    {:else}
      <!-- The signed-out panel stops at the page's own build. Saying so is the point: an absent
           deployment list with no sentence beside it reads as an outage, and this is a session
           boundary — and the same is true of the firm's database, which a visitor has not named
           yet. -->
      <Separator />
      <p class="text-xs text-text-muted">{SIGNED_OUT_ESTATE_NOTICE}</p>
      <p class="text-xs text-text-muted">{SIGNED_OUT_DATABASE_NOTICE}</p>
    {/if}
  </Popover.Content>
</Popover.Root>
