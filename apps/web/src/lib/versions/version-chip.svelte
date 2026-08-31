<script lang="ts">
  /*
   * The version chip and its overlay — chrome, so it may carry identity quietly (the edges rule).
   * The chip always shows THIS build's own short commit, baked in at build time, so it renders
   * whether or not the API answers; opening it asks GET /api/v1/meta/versions what every other
   * part of the deployment is running.
   *
   * EVERY ROW NAMES ITS DEPLOYED UNIT. The heading is the Cloudflare Worker someone would open in
   * the dashboard (`magna-carta-scan`, `magna-carta-convert`, …) and the description of what it
   * does follows underneath it. A row that says "Not reporting" is only actionable if the reader
   * can tell which project is silent, so the identity leads and the description supports it; the
   * names come from the service bindings and the operations runbook, never from this file's
   * imagination (version-overlay-model.ts records where each one was read).
   *
   * ONE WORKER SERVES BOTH THE PAGE AND THE API. `apps/api-worker/wrangler.jsonc` binds
   * `assets: { directory: "../web/build" }`, so the SPA is bundled INTO the `magna-carta`
   * deployment rather than shipped beside it. The panel says so between the two rows, because the
   * fact is invisible from the outside and its absence is expensive: a green build of the
   * assets-only `magna-carta-web` project changes nothing about what this site serves, and
   * watching that project go green while the old page stayed up is exactly the confusion this
   * line exists to prevent.
   *
   * TWO SCOPES, ONE COMPONENT. Inside a session (`scope="app"`) the panel reports the whole
   * deployment. On the signed-out surfaces (`scope="public"` — sign in, password reset, the
   * joining screens) it reports the web app only: that build identifier is already inside the
   * bundle the visitor downloaded, so showing it discloses nothing new, while the aggregate is an
   * authenticated read that a signed-out page must not attempt. No call is made there, and the
   * panel says whose version it is showing rather than leaving the absence to read as a fault.
   *
   * Honesty rules the panel keeps:
   * - The web row never comes from the network and the API/services rows never come from anywhere
   *   but the read; a failed read is said out loud with its Error ID, never papered over.
   * - The service observation is briefly cached server-side, so once it is old enough to matter
   *   the header says when it was actually taken.
   * - Naming the Worker is ADDITIONAL to saying which silence a row is in, never a replacement:
   *   "not wired here" / "did not answer" / "answering from a build too old to say" all survive.
   * - A re-ask that fails keeps the rows it already had and says they are the older read's, so
   *   nothing on screen is left looking current when it is not.
   * - A difference between the two commits is called out for what it can be, given one Worker
   *   carries both: this page was served by an earlier deployment than the one now answering.
   * - Every version is copyable: one click puts the part's identifier line on the clipboard.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import Separator from "@magna-carta/design-system/separator";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import GitCommitHorizontal from "@lucide/svelte/icons/git-commit-horizontal";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { requestJson, type ApiProblem } from "$lib/api/request.ts";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import {
    buildsDiffer,
    copyLineForPart,
    deployedUnitName,
    describeObservationAge,
    describeRetainedRows,
    formatVersionTimestamp,
    isRealCommit,
    joinDetailSegments,
    readsServiceAggregate,
    serviceStateDescription,
    serviceStateLabel,
    versionChipLabel,
    API_ROW_DESCRIPTION,
    API_WORKER_UNIT_NAME,
    BUILD_SKEW_EXPLANATION,
    NO_SERVICES_NOTICE,
    READ_IN_FLIGHT_NOTICE,
    SIGNED_OUT_ESTATE_NOTICE,
    WEB_APP_ROW_DESCRIPTION,
    WEB_APP_SHIPS_INSIDE_API_NOTICE,
    type MetaVersionsValue,
    type ServiceVersionState,
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

  async function refresh(): Promise<void> {
    // The guard lives on the call itself, not only on its caller: a signed-out panel has no path
    // to the authenticated aggregate at all, including through Refresh and the failure Retry.
    if (!readsAggregate) return;
    loading = true;
    const outcome = await requestJson<MetaVersionsValue>(fetch, "/api/v1/meta/versions");
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

  const mismatch = $derived(value !== null && buildsDiffer(BUILD_IDENTITY.commit, value.api.commit));
  const observationAge = $derived(
    value === null ? null : describeObservationAge(value.observedAt, nowEpochMilliseconds),
  );
  // Rows that survived a failed re-ask. They are the older read's, and the failure block says so.
  const retainedRows = $derived(
    failure !== null && value !== null
      ? describeRetainedRows(value.observedAt, nowEpochMilliseconds)
      : null,
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
    // The check appears only when the clipboard actually took the text — a denied clipboard
    // permission must not claim a copy that never happened (and must not surface as a page error).
    try {
      await navigator.clipboard.writeText(copyLineForPart(part));
    } catch {
      return;
    }
    copiedRow = rowKey;
    setTimeout(() => {
      if (copiedRow === rowKey) copiedRow = null;
    }, 2000);
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
  unitName: string | null;
  description: string;
  state: ServiceVersionState;
  commit: string | null;
  commitTime: string | null;
  buildTime: string | null;
})}
  <!-- The heading is the deployed unit; the description drops to the detail line beneath it. When
       this build has no name for the unit (a service added to the API's roster and not here), the
       description takes the heading back rather than the row borrowing a neighbour's name. -->
  {@const heading = part.unitName ?? part.description}
  {@const copyLabel = part.unitName === null ? part.description : `${part.unitName} (${part.description})`}
  {@const detail = joinDetailSegments([
    part.unitName === null ? null : part.description,
    metaLineFor(part.commitTime, part.buildTime) ?? serviceStateDescription(part.state),
  ])}
  {@const stateLabel = serviceStateLabel(part.state)}
  <div class="flex items-center justify-between gap-8 py-4">
    <div class="flex min-w-0 flex-col">
      <!-- Monospace marks an identifier. A row this build has no name for falls back to its
           description, which is prose, so it drops the mono with the identity it never had. -->
      <span
        class={part.unitName === null
          ? "text-sm text-text-default"
          : "font-mono text-sm text-text-default"}>{heading}</span
      >
      <!-- One detail line, carrying what the unit is for and then what it is doing. The second
           half is the part that separates "this deployment has no such service" from "it is not
           answering" from "it answers, but its build predates the question" — three facts the
           badges alone read as one outage. -->
      {#if detail !== null}
        <span class="text-xs text-text-muted">{detail}</span>
      {/if}
    </div>
    {#if part.state === "reported" && part.commit !== null}
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0 font-mono text-xs tabular-nums"
        aria-label="Copy the {copyLabel} version"
        onclick={() =>
          copyPart(part.rowKey, {
            label: copyLabel,
            commit: part.commit ?? "",
            commitTime: part.commitTime,
            buildTime: part.buildTime,
          })}
      >
        {part.commit}
        {#if copiedRow === part.rowKey}
          <Check class="size-16" aria-hidden="true" />
        {:else}
          <Copy class="size-16" aria-hidden="true" />
        {/if}
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
    aria-label="Build Versions: {chipLabel}"
  >
    <GitCommitHorizontal class="size-16" aria-hidden="true" />
    <span class="font-mono">{chipLabel}</span>
  </Popover.Trigger>
  <!-- Sizing rides inline style, not a recipe: the max-height ceiling is the Bits-provided
       available viewport height (the same pattern the select listbox uses), so a short window
       scrolls the panel instead of clipping the service rows off-screen. -->
  <Popover.Content
    align="end"
    class="mc-scrollbar flex flex-col gap-8 overflow-y-auto"
    style="inline-size: var(--mc-size-prose); max-height: var(--bits-floating-available-height)"
  >
    <div class="flex items-center justify-between gap-8">
      <p class="text-sm font-medium">Build Versions</p>
      {#if readsAggregate}
        <div class="flex items-center gap-8">
          <!-- The in-flight word sits where the age line sits, so a re-ask is visible before its
               answer lands without a spinner and without moving anything. -->
          {#if loading}
            <p class="text-xs text-text-muted">{READ_IN_FLIGHT_NOTICE}</p>
          {:else if observationAge !== null}
            <p class="text-xs text-text-muted">Services {observationAge}</p>
          {/if}
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0"
            aria-label="Refresh the version read"
            aria-busy={loading}
            disabled={loading}
            onclick={() => refresh()}
          >
            <RefreshCw class="size-16" aria-hidden="true" />
          </Button>
        </div>
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
          <Button variant="secondary" size="sm" disabled={loading} onclick={() => refresh()}>
            Retry
          </Button>
        </div>
      </div>
    {/if}

    {#if mismatch}
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-8">
          <Badge variant="warning">Different Builds</Badge>
        </div>
        <p class="text-xs text-text-muted">{BUILD_SKEW_EXPLANATION}</p>
      </div>
    {/if}

    {@render partRow({
      rowKey: "web",
      unitName: API_WORKER_UNIT_NAME,
      description: WEB_APP_ROW_DESCRIPTION,
      state: "reported",
      commit: webCommitLabel,
      commitTime: BUILD_IDENTITY.committedAt,
      buildTime: BUILD_IDENTITY.builtAt,
    })}

    {#if readsAggregate}
      {#if value !== null}
        {@render partRow({
          rowKey: "api",
          unitName: API_WORKER_UNIT_NAME,
          description: API_ROW_DESCRIPTION,
          state: "reported",
          commit: isRealCommit(value.api.commit) ? value.api.commit : "dev",
          commitTime: value.api.commitTime,
          buildTime: value.api.buildTime,
        })}
      {:else if loading}
        <div class="flex items-center justify-between gap-8 py-4">
          <div class="flex min-w-0 flex-col">
            <span class="font-mono text-sm text-text-default">{API_WORKER_UNIT_NAME}</span>
            <span class="text-xs text-text-muted">{API_ROW_DESCRIPTION}</span>
          </div>
          <Skeleton class="h-16 w-96" />
        </div>
      {/if}
      <!-- Both rows above name the same Worker, and that is the point rather than a rendering
           fault. The line says why, where a reader comparing the two will read it. -->
      <p class="text-xs text-text-muted">{WEB_APP_SHIPS_INSIDE_API_NOTICE}</p>
    {:else}
      <!-- The signed-out panel stops at the web app. Saying so is the point: an absent API row
           with no sentence beside it reads as an outage, and this is a session boundary. -->
      <Separator />
      <p class="text-xs text-text-muted">{SIGNED_OUT_ESTATE_NOTICE}</p>
    {/if}

    {#if value !== null || loading}
      <Separator />
      <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Services
      </p>
      {#if value === null}
        <div class="flex flex-col gap-8" aria-busy="true">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>
      {:else if value.services.length === 0}
        <p class="text-xs text-text-muted">{NO_SERVICES_NOTICE}</p>
      {:else}
        <div class="flex flex-col">
          {#each value.services as service (service.id)}
            {@render partRow({
              rowKey: service.id,
              unitName: deployedUnitName(service.id),
              description: service.label,
              state: service.state,
              commit: service.commit,
              commitTime: service.commitTime,
              buildTime: service.buildTime,
            })}
          {/each}
        </div>
      {/if}
    {/if}
  </Popover.Content>
</Popover.Root>
