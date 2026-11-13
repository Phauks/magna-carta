<script lang="ts">
  /*
   * The board's Known Issues: what the public status page says is wrong right now, with its latest
   * update, so a reader who came to report a problem sees first that it is already known. The
   * status page is the record; this screen repeats its open events and links there.
   */
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import CommunityTopBar from "./community-top-bar.svelte";
  import type { KnownIssue } from "./board-client.ts";

  let {
    issues,
    statusPageUrl,
    viewerDisplayName,
    signInUrl = null,
    failure = null,
    onRetry,
    onSignOut,
  }: {
    issues: readonly KnownIssue[];
    statusPageUrl: string;
    viewerDisplayName: string | null;
    signInUrl?: string | null;
    failure?: Failure | null;
    onRetry?: () => void;
    onSignOut?: () => void;
  } = $props();

  const IMPACT: Record<KnownIssue["impact"], { label: string; variant: "warning" | "danger" | "info" }> = {
    minor: { label: "Minor", variant: "warning" },
    major: { label: "Major", variant: "danger" },
    critical: { label: "Critical", variant: "danger" },
    maintenance: { label: "Maintenance", variant: "info" },
  };
  const LIFECYCLE: Record<KnownIssue["lifecycle"], string> = {
    investigating: "Investigating",
    identified: "Identified",
    monitoring: "Monitoring a fix",
    resolved: "Resolved",
  };
</script>

<div class="flex min-h-screen flex-col bg-surface-sunken text-text-default">
  <CommunityTopBar current="known-issues" {viewerDisplayName} {signInUrl} {onSignOut} />
  <main class="flex flex-col gap-16 px-32 py-24">
    <div class="flex flex-wrap items-baseline gap-12">
      <h1 class="text-2xl font-semibold">Known Issues</h1>
      <a class="text-sm font-semibold text-text-link" href={statusPageUrl}>Open the Status Page</a>
    </div>
    {#if failure !== null}
      <FailureNotice {failure} subject="Known issues" {onRetry} />
    {:else if issues.length === 0}
      <EmptyState title="Nothing Known">
        Nothing is wrong that the Magna Carta team knows of. If something is not working, report it from
        inside Magna Carta so it reaches the team privately.
      </EmptyState>
    {:else}
      <ol class="flex flex-col gap-12">
        {#each issues as issue (issue.id)}
          <li class="flex flex-col gap-8 rounded-lg border border-border-default bg-surface-default p-16">
            <div class="flex flex-wrap items-center gap-8 text-xs text-text-subtle">
              <Badge variant={IMPACT[issue.impact].variant} caps>{IMPACT[issue.impact].label}</Badge>
              <span class="font-semibold text-text-muted">{LIFECYCLE[issue.lifecycle]}</span>
              <span>Since <time datetime={issue.startedAt}>{formatInstant(issue.startedAt)}</time></span>
            </div>
            <h2 class="text-md font-semibold">{issue.title}</h2>
            {#if issue.latestUpdate !== null}
              <p class="text-sm whitespace-pre-line">{issue.latestUpdate.body}</p>
              <p class="text-xs text-text-subtle">
                Updated <time datetime={issue.latestUpdate.at}>{formatInstant(issue.latestUpdate.at)}</time>
              </p>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </main>
</div>
