<script lang="ts">
  /*
   * The version chip and its overlay — chrome, so it may carry identity quietly (the edges rule).
   * The chip always shows THIS build's own short commit, baked in at build time, so it renders
   * whether or not the API answers; opening it asks GET /api/v1/meta/versions what every other
   * part of the deployment is running.
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
   * - A skew between the web app's and the API's commits is called out the moment both are real:
   *   the two deploy separately, and "which build am I on" has two answers when they differ.
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
  import { requestJson, type ApiProblem } from "$lib/api/request.ts";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import {
    buildsDiffer,
    copyLineForPart,
    describeObservationAge,
    formatVersionTimestamp,
    isRealCommit,
    readsServiceAggregate,
    serviceStateDescription,
    serviceStateLabel,
    versionChipLabel,
    SIGNED_OUT_ESTATE_NOTICE,
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
  let copiedLabel = $state<string | null>(null);
  let nowEpochMilliseconds = $state(Date.now());

  const chipLabel = versionChipLabel(BUILD_IDENTITY.commit);
  const webCommitLabel = isRealCommit(BUILD_IDENTITY.commit) ? BUILD_IDENTITY.commit : "dev";

  async function refresh(): Promise<void> {
    // The guard lives on the call itself, not only on its caller: a signed-out panel has no path
    // to the authenticated aggregate at all, including through the failure block's Retry.
    if (!readsAggregate) return;
    loading = true;
    const outcome = await requestJson<MetaVersionsValue>(fetch, "/api/v1/meta/versions");
    loading = false;
    if (outcome.kind === "ok") {
      value = outcome.value;
      failure = null;
    } else if (outcome.kind === "problem") {
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

  const mismatch = $derived(
    value !== null && buildsDiffer(BUILD_IDENTITY.commit, value.api.commit),
  );
  const observationAge = $derived(
    value === null ? null : describeObservationAge(value.observedAt, nowEpochMilliseconds),
  );

  async function copyPart(part: {
    label: string;
    commit: string;
    commitTime: string | null;
    buildTime: string | null;
  }): Promise<void> {
    // The check appears only when the clipboard actually took the text — a denied clipboard
    // permission must not claim a copy that never happened (and must not surface as a page error).
    try {
      await navigator.clipboard.writeText(copyLineForPart(part));
    } catch {
      return;
    }
    copiedLabel = part.label;
    setTimeout(() => {
      if (copiedLabel === part.label) copiedLabel = null;
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

{#snippet copyableCommit(part: {
  label: string;
  commit: string;
  commitTime: string | null;
  buildTime: string | null;
})}
  <Button
    variant="ghost"
    size="sm"
    class="shrink-0 font-mono text-xs tabular-nums"
    aria-label="Copy the {part.label} version"
    onclick={() => copyPart(part)}
  >
    {part.commit}
    {#if copiedLabel === part.label}
      <Check class="size-16" aria-hidden="true" />
    {:else}
      <Copy class="size-16" aria-hidden="true" />
    {/if}
  </Button>
{/snippet}

{#snippet partRow(part: {
  label: string;
  state: ServiceVersionState;
  commit: string | null;
  commitTime: string | null;
  buildTime: string | null;
})}
  {@const stateLabel = serviceStateLabel(part.state)}
  {@const stateDescription = serviceStateDescription(part.state)}
  {@const metaLine = metaLineFor(part.commitTime, part.buildTime)}
  <div class="flex items-center justify-between gap-8 py-4">
    <div class="flex min-w-0 flex-col">
      <span class="text-sm text-text-default">{part.label}</span>
      <!-- One second line, and the two cases never coexist: a reported row has timestamps and no
           badge to explain, a non-answering row has a badge and no timestamps. The sentence is
           what separates "this deployment has no such service" from "it is not answering" from
           "it answers, but its build predates the question" — three facts the badges alone read
           as one outage. -->
      {#if metaLine !== null}
        <span class="text-xs text-text-muted">{metaLine}</span>
      {:else if stateDescription !== null}
        <span class="text-xs text-text-muted">{stateDescription}</span>
      {/if}
    </div>
    {#if part.state === "reported" && part.commit !== null}
      {@render copyableCommit({
        label: part.label,
        commit: part.commit,
        commitTime: part.commitTime,
        buildTime: part.buildTime,
      })}
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
    <div class="flex items-baseline justify-between gap-8">
      <p class="text-sm font-medium">Build Versions</p>
      {#if observationAge !== null}
        <p class="text-xs text-text-muted">Services {observationAge}</p>
      {/if}
    </div>

    {#if mismatch}
      <div class="flex items-center gap-8">
        <Badge variant="warning">Different Builds</Badge>
        <p class="text-xs text-text-muted">
          The web app and the API are running different builds.
        </p>
      </div>
    {/if}

    {@render partRow({
      label: "Web App",
      state: "reported",
      commit: webCommitLabel,
      commitTime: BUILD_IDENTITY.committedAt,
      buildTime: BUILD_IDENTITY.builtAt,
    })}

    {#if !readsAggregate}
      <!-- The signed-out panel stops at the web app. Saying so is the point: an absent API row
           with no sentence beside it reads as an outage, and this is a session boundary. -->
      <Separator />
      <p class="text-xs text-text-muted">{SIGNED_OUT_ESTATE_NOTICE}</p>
    {/if}

    {#if value !== null}
      {@render partRow({
        label: "API",
        state: "reported",
        commit: isRealCommit(value.api.commit) ? value.api.commit : "dev",
        commitTime: value.api.commitTime,
        buildTime: value.api.buildTime,
      })}
    {:else if loading}
      <div class="flex items-center justify-between gap-8 py-4">
        <span class="text-sm text-text-default">API</span>
        <Skeleton class="h-16 w-96" />
      </div>
    {/if}

    {#if failure !== null}
      <div class="flex flex-col gap-4">
        <p class="text-sm text-text-default">
          {failure.kind === "problem"
            ? "The version read failed."
            : "The API could not be reached."}
        </p>
        {#if failure.kind === "problem"}
          <p class="text-xs text-text-muted">
            Error ID: {failure.problem.errorId ?? "not yet assigned"} · status {failure.problem
              .status}
          </p>
        {/if}
        <div>
          <Button variant="secondary" size="sm" onclick={() => refresh()}>Retry</Button>
        </div>
      </div>
    {/if}

    {#if value !== null || loading}
      <Separator />
      <p
        class="text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        Services
      </p>
      {#if value !== null}
        <div class="flex flex-col">
          {#each value.services as service (service.id)}
            {@render partRow(service)}
          {/each}
        </div>
      {:else}
        <div class="flex flex-col gap-8" aria-busy="true">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
        </div>
      {/if}
    {/if}
  </Popover.Content>
</Popover.Root>
