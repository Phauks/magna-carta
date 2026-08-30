<script lang="ts">
  /*
   * Where a matter stands on conflicts — the reusable panel, so the standalone surface, a matter's
   * own tab and the intake flow all read the same thing.
   *
   * THERE IS NO VERDICT HERE, AND THERE IS NOTHING TO ADD ONE TO. The read this renders has no
   * aggregate and no summary field by design: the platform reports what it searched, what it could
   * not search, and what no reviewer has answered, because a firm defending a disqualification
   * motion defends a PROCEDURE and cannot defend a conclusion its software drew. So this panel
   * states facts and counts, and the only thing it makes loud is an open question.
   *
   * NEVER CHECKED IS ITS OWN STATE. A matter nobody has run a check on is not a matter whose check
   * surfaced nothing, and it is not a matter whose sources were all unavailable. Three different
   * facts, and a single line that blurred them would be the failure this whole subsystem exists to
   * prevent.
   *
   * STALENESS IS COMPUTED, NOT STORED. The shortfall against the firm's current policy and the
   * re-checks the platform knows are owed are both derived at read time, so raising the firm's floor
   * shows up here immediately with no sweep and nothing written onto the matter.
   */
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import EventRail from "@magna-carta/design-system/event-rail";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import type { Snippet } from "svelte";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { soonControlProperties } from "$lib/maturity/soon-affordance.ts";
  import ScopeInForce from "./scope-in-force.svelte";
  import { gapReason } from "./conflicts-gaps.ts";
  import type { MatterConflictsPosture } from "./conflicts-api.ts";
  import {
    causeTopicLabel,
    dispositionVocabulary,
    evidenceTier,
    sourceVocabulary,
    strictnessVocabulary,
    triggerVocabulary,
    UNANSWERED,
  } from "./conflicts-vocabulary.ts";

  let {
    posture,
    loading = false,
    memberNames = new Map<string, string>(),
    checkHref,
    actions,
  }: {
    /** The matter's standing. Null while it is being read. */
    posture: MatterConflictsPosture | null;
    loading?: boolean;
    /** Member names by user handle, so a reviewer is a person rather than a handle. */
    memberNames?: ReadonlyMap<string, string>;
    /** Where the latest check is read. Omit and the check is named without a link. */
    checkHref?: (checkId: string) => string;
    /** What a reader may do from here — running a check, most of the time. */
    actions?: Snippet;
  } = $props();

  const recheckDescription = $props.id();
  const soonRecheck = soonControlProperties(gapReason("rescanNow"), recheckDescription);

  const latest = $derived(posture?.latestCheck ?? null);
  const openQuestions = $derived(
    (posture?.undisposedByTier ?? []).reduce((total, entry) => total + entry.count, 0),
  );

  function memberText(userId: string | null): string {
    if (userId === null) return "No acting member recorded";
    return personName(memberNames.get(userId) ?? null, { whenUnrecorded: userId });
  }

  /** The re-checks the platform knows are owed, oldest cause first — the rail's own order. */
  const pendingEvents = $derived.by((): EventRailEvent[] =>
    (posture?.pendingRecheck ?? []).map((pending, index) => ({
      id: `${pending.causeTopic}-${pending.causeReference}-${String(index)}`,
      action: causeTopicLabel(pending.causeTopic),
      at: pending.causeOccurredAt,
      source: "The firm's own records",
      detail: `Noticed ${formatInstant(pending.requestedAt)}. Reference ${pending.causeReference}.`,
    })),
  );
</script>

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right" {title}>{value}</dd>
  </div>
{/snippet}

{#if loading || posture === null}
  <div class="flex flex-col gap-8">
    <Skeleton class="h-16 w-full" />
    <Skeleton class="h-16 w-3/4" />
    <Skeleton class="h-16 w-1/2" />
  </div>
{:else if posture.neverChecked && posture.pendingRecheck.length === 0}
  <EmptyState title="This Matter Has Never Been Checked" {actions}>
    No check has ever named this matter. That is a different state from a check that ran and
    surfaced nothing, and neither of them is a statement about the matter itself.
  </EmptyState>
{:else}
  <div class="flex flex-col gap-24">
    <section class="flex flex-col gap-8">
      <div class="flex flex-wrap items-center justify-between gap-16">
        <h3 class="text-xs text-text-subtle uppercase">Open Questions</h3>
        {#if openQuestions > 0}
          <Badge variant={UNANSWERED.tone} title={UNANSWERED.meaning}>
            {String(openQuestions)}
            {openQuestions === 1 ? "unanswered candidate" : "unanswered candidates"}
          </Badge>
        {/if}
      </div>
      <!-- All four tiers, zero included: an absent tier would read as nothing to say, and the whole
           point of this block is that an unanswered question is stated out loud. -->
      <dl class="flex flex-col gap-4 text-sm">
        {#each posture.undisposedByTier as entry (entry.tier)}
          {@const tier = evidenceTier(entry.tier)}
          {@render fact(tier.label, String(entry.count), tier.meaning)}
        {/each}
      </dl>
    </section>

    {#if posture.dispositionsByKind.length > 0}
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Answered</h3>
        <dl class="flex flex-col gap-4 text-sm">
          {#each posture.dispositionsByKind as entry (entry.kind)}
            {@const word = dispositionVocabulary(entry.kind)}
            <div class="flex items-baseline justify-between gap-16">
              <dt class="text-text-muted" title={word.meaning}>{word.label}</dt>
              <dd class="text-right">
                {String(entry.count)} &middot; {entry.reviewerUserIds
                  .map((userId) => memberText(userId))
                  .join(", ")}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/if}

    {#if latest !== null}
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">The Latest Check</h3>
        <dl class="flex flex-col gap-4 text-sm">
          {@render fact("Run", formatInstant(latest.createdAt))}
          {@render fact(
            "Trigger",
            triggerVocabulary(latest.trigger).label,
            triggerVocabulary(latest.trigger).meaning,
          )}
          {@render fact("Run By", memberText(latest.actorUserId))}
          {@render fact("Subject Parties", String(latest.subjectEntityCount))}
          {@render fact("Entities Reached", String(latest.expandedEntityCount))}
          {@render fact("Candidates", String(latest.hitCount))}
          {#if latest.skippedIdentifierTypes.length > 0}
            {@render fact(
              "Not Probed On Their Own",
              latest.skippedIdentifierTypes.join(", "),
              "The corpus cannot index these identifier types on their own, so the log never implies they were searched.",
            )}
          {/if}
        </dl>
        {#if checkHref !== undefined}
          <a class="text-sm underline underline-offset-2" href={checkHref(latest.id)}>
            Read the check
          </a>
        {/if}
      </section>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">What It Searched</h3>
        <ScopeInForce scope={latest.scope} />
      </section>
    {/if}

    {#if posture.scopeShortfall.sources.length > 0 || posture.scopeShortfall.strictness !== null || posture.scopeShortfall.depth !== null}
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Below The Firm's Current Policy</h3>
        <dl class="flex flex-col gap-4 text-sm">
          {#if posture.scopeShortfall.sources.length > 0}
            {@render fact(
              "Sources Never Considered",
              posture.scopeShortfall.sources
                .map((source) => sourceVocabulary(source).label)
                .join(", "),
              "The firm's policy requires these and the latest check did not consider them at all. A source it DID consider and could not run is reported separately.",
            )}
          {/if}
          {#if posture.scopeShortfall.strictness !== null}
            {@render fact(
              "Strictness",
              `Ran under ${strictnessVocabulary(posture.scopeShortfall.strictness.ranUnder).label}; the firm's floor is now ${strictnessVocabulary(posture.scopeShortfall.strictness.firmFloor).label}`,
            )}
          {/if}
          {#if posture.scopeShortfall.depth !== null}
            {@render fact(
              "Traversal Budget",
              `Ran at ${String(posture.scopeShortfall.depth.ranAt)}; the firm's default is ${String(posture.scopeShortfall.depth.firmDefault)}`,
              "Depth is a default rather than a floor, so a shallower run is honoured. This reports the difference, not a refusal.",
            )}
          {/if}
        </dl>
      </section>
    {/if}

    {#if posture.unavailableSources.length > 0}
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <h3 class="text-xs text-text-subtle uppercase">Could Not Be Searched</h3>
        <dl class="flex flex-col gap-4 text-sm">
          {#each posture.unavailableSources as entry (entry.source)}
            <div class="flex flex-col gap-4">
              <dt class="text-text-muted">{sourceVocabulary(entry.source).label}</dt>
              <dd>{entry.reason}</dd>
            </div>
          {/each}
        </dl>
      </section>
    {/if}

    <section class="flex flex-col gap-8 border-t border-border-default pt-12">
      <div class="flex flex-wrap items-center justify-between gap-16">
        <h3 class="text-xs text-text-subtle uppercase">Re-checks Owed</h3>
        <div class="flex items-center gap-8">
          <MaturityBadge stage="soon" />
          <span class="text-xs text-text-muted" title={soonRecheck.title}>
            Asking for one on demand
          </span>
        </div>
      </div>
      <EventRail
        events={pendingEvents}
        label="Re-checks this matter is owed"
        emptyMessage="The platform knows of no corpus change since the last check that would have changed its answer."
      />
      <p id={recheckDescription} class="sr-only">{soonRecheck.title}</p>
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(
          "Scheduled Re-screening",
          posture.periodicRescan.enabled
            ? `Every ${String(posture.periodicRescan.intervalDays)} days`
            : "Switched off by the firm",
          posture.periodicRescan.enabled
            ? undefined
            : "A backstop the firm has switched off is a choice about its own procedure, and it is stated rather than left invisible.",
        )}
        {@render fact(
          "Last Scheduled Pass",
          posture.periodicRescan.lastRunAt === null
            ? "No scheduled pass has run"
            : formatInstant(posture.periodicRescan.lastRunAt),
        )}
      </dl>
    </section>

    {#if actions}
      <div class="flex flex-wrap items-center gap-8">{@render actions()}</div>
    {/if}
  </div>
{/if}
