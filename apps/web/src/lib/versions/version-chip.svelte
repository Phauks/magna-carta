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
   * the page's commit and the API's commit are allowed to differ without a warning — a difference
   * is the normal state whenever one of them shipped more recently, and the panel says so in one
   * line under the deployment list instead of raising an alarm about it
   * (version-overlay-model.ts records why the old "Different Builds" warning was retired).
   *
   * THE CHIP NOTICES AN UPSTREAM DEPLOY. SvelteKit's version poll (svelte.config.js names each
   * build by its commit) compares the running bundle against what the deployment serving it is
   * publishing now; when a newer bundle is live the chip carries a warning dot and a Reload control
   * appears in the panel header, beside Refresh, where the panel's other gesture already is.
   *
   * TWO SCOPES, ONE COMPONENT. Inside a session (`scope="app"`) the panel reports the whole
   * deployment. On the signed-out surfaces (`scope="public"` — sign in, password reset, the
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
  import Button from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import Separator from "@magna-carta/design-system/separator";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import { updated } from "$app/state";
  import { requestJson, type ApiProblem } from "$lib/api/request.ts";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import { fleetSectionPreference } from "$lib/versions/version-panel-preferences.svelte.ts";
  import {
    copyLineForPart,
    describeObservationAge,
    describeRetainedRows,
    findWebWorkerRow,
    formatVersionTimestamp,
    isRealCommit,
    partitionDeploymentRows,
    readsServiceAggregate,
    serviceStateDescription,
    serviceStateLabel,
    showsPageBuildRow,
    summarizeSilentWorkers,
    versionChipLabel,
    API_WORKER_UNIT_NAME,
    FLEET_SECTION_LABEL,
    NO_SERVICES_NOTICE,
    PAGE_BUILD_ROW_NAME,
    READ_IN_FLIGHT_NOTICE,
    RELOAD_ACTION_LABEL,
    SIGNED_OUT_ESTATE_NOTICE,
    UPDATE_AVAILABLE_EXPLANATION,
    WEB_TOPOLOGY_NOTICE,
    type MetaVersionsValue,
    type ServiceVersionState,
    type VersionReadPhase,
    type VersionScope,
  } from "$lib/versions/version-overlay-model.ts";

  let { scope = "app" }: { scope?: VersionScope } = $props();

  const readsAggregate = $derived(readsServiceAggregate(scope));

  let open = $state(false);
  let value = $state<MetaVersionsValue | null>(null);
  let failure = $state<{ kind: "problem"; problem: ApiProblem } | { kind: "transport" } | null>(
    null,
  );
  let loading = $state(false);
  let copiedRow = $state<string | null>(null);
  let nowEpochMilliseconds = $state(Date.now());

  const chipLabel = versionChipLabel(BUILD_IDENTITY.commit);
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

  // Every open re-reads (the API's brief cache absorbs the cost), and while the panel is open a
  // slow tick keeps the observation-age line moving instead of freezing at its first render.
  $effect(() => {
    if (!open || !readsAggregate) return;
    void refresh();
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
  <Popover.Trigger
    class="mc-top-bar-icon-button gap-8 border text-xs tabular-nums"
    style="border-color: var(--mc-chrome-border)"
    aria-label="Build Versions: {chipLabel}{updateAvailable ? ' (update available)' : ''}"
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
            <Button
              variant="ghost"
              size="icon"
              class="shrink-0"
              aria-label="Refresh the version read"
              aria-busy={loading}
              disabled={loading}
              onclick={() => refresh({ fresh: true })}
            >
              <RefreshCw class="size-16" aria-hidden="true" />
            </Button>
          {/if}
        </div>
      </div>
      <!-- Under the header, not beside it: the age line grows and shrinks as the clock ticks, and
           on the header row that motion pushed the controls around (owner ruling, 2026-08-31). The
           in-flight word takes the same seat, so a re-ask is visible before its answer lands
           without a spinner and without moving anything. -->
      {#if loading}
        <p class="text-xs text-text-muted">{READ_IN_FLIGHT_NOTICE}</p>
      {:else if observationAge !== null}
        <p class="text-xs text-text-muted">Services {observationAge}</p>
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
           newer bundle where this page came from. A page-versus-API commit difference deliberately
           raises nothing — the two Workers deploy separately, so differing is the normal state
           (the topology line below says so). -->
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
        <p
          class="text-xs text-text-muted uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          Deployment
        </p>
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
          {:else}
            {@const deploymentRows = partitionDeploymentRows(value.services)}
            <!-- The two Workers that serve the app's address lead the list, with the topology
                 line that explains them; the rest of the fleet sits beneath the fold. -->
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
            <p class="text-xs text-text-muted">{WEB_TOPOLOGY_NOTICE}</p>
            {#if deploymentRows.rest.length > 0}
              {@const silentWorkers = summarizeSilentWorkers(deploymentRows.rest)}
              <Separator />
              <!-- The fold. Its own visible label is its accessible name, aria-expanded carries
                   the state, and when it is shut the count of Workers that came back without a
                   version rides beside it, so folding the list away never folds a fault away. -->
              <Button
                variant="ghost"
                size="sm"
                class="w-full justify-between gap-8"
                aria-expanded={!fleetSectionPreference.collapsed}
                onclick={() => fleetSectionPreference.toggle()}
              >
                <span class="flex items-center gap-8">
                  <span class="uppercase" style="letter-spacing: var(--mc-tracking-caps)">
                    {FLEET_SECTION_LABEL}
                  </span>
                  {#if fleetSectionPreference.collapsed && silentWorkers !== null}
                    <Badge variant="warning">{silentWorkers}</Badge>
                  {/if}
                </span>
                <ChevronRight
                  class="size-16 shrink-0 text-text-muted transition-transform duration-fast ease-standard motion-reduce:transition-none {fleetSectionPreference.collapsed
                    ? ''
                    : 'rotate-90'}"
                  aria-hidden="true"
                />
              </Button>
              {#if !fleetSectionPreference.collapsed}
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
            {/if}
          {/if}
        {:else}
          <div class="flex flex-col gap-8" aria-busy="true">
            <Skeleton class="h-16 w-full" />
            <Skeleton class="h-16 w-full" />
            <Skeleton class="h-16 w-full" />
          </div>
        {/if}
      {/if}
    {:else}
      <!-- The signed-out panel stops at the page's own build. Saying so is the point: an absent
           deployment list with no sentence beside it reads as an outage, and this is a session
           boundary. -->
      <Separator />
      <p class="text-xs text-text-muted">{SIGNED_OUT_ESTATE_NOTICE}</p>
    {/if}
  </Popover.Content>
</Popover.Root>
