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
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleDate, sampleInstant, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { Snippet } from "svelte";
  import ScopeInForce from "./scope-in-force.svelte";
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
    recheckAction,
    onRetry,
  }: {
    /** The matter's standing. Null while it is being read. */
    posture: MatterConflictsPosture | null;
    /** True while the standing is being read — a first read, or a re-read of the one on screen. */
    loading?: boolean;
    /** How to ask for the standing again, offered when a read stays in flight too long. */
    onRetry?: () => void;
    /** Member names by user handle, so a reviewer is a person rather than a handle. */
    memberNames?: ReadonlyMap<string, string>;
    /** Where the latest check is read. Omit and the check is named without a link. */
    checkHref?: (checkId: string) => string;
    /** What a reader may do from here — running a check, most of the time. */
    actions?: Snippet;
    /** Offered beside "Re-checks Owed": asking for one now, where the reader may run checks. */
    recheckAction?: Snippet;
  } = $props();

  const latest = $derived(posture?.latestCheck ?? null);
  const openQuestions = $derived(
    (posture?.undisposedByTier ?? []).reduce((total, entry) => total + entry.count, 0),
  );

  function memberText(userId: string | null): string {
    if (userId === null) return "No acting member recorded";
    return personName(memberNames.get(userId) ?? null, { whenUnrecorded: userId });
  }

  /*
   * The shape the panel takes while a matter's standing is read: its own sections, over invented
   * facts from the sample vocabulary. Inert and hidden from assistive technology while it stands,
   * so no count in it can be read as a matter's real posture.
   */
  const RECHECK_FIXTURE: readonly EventRailEvent[] = [
    {
      id: "fixture-relationship",
      action: "A relationship was recorded",
      at: sampleInstant(1),
      source: "The firm's own records",
      detail: "Noticed 11 Feb 2026, 10:32. Reference edge_0k4x7.",
    },
    {
      id: "fixture-renamed",
      action: "A Directory record gained another name",
      at: sampleInstant(0),
      source: "The firm's own records",
      detail: "Noticed 14 Feb 2026, 15:04. Reference ent_0p9m2.",
    },
  ];

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

<LoadingRegion
  loading={posture === null}
  refreshing={loading}
  empty={posture !== null && posture.neverChecked && posture.pendingRecheck.length === 0}
  label="Reading where this matter stands on conflicts"
  {onRetry}
  class="flex flex-col gap-24"
>
  {#snippet emptyState()}
    <EmptyState title="This Matter Has Never Been Checked" {actions}>
      No check has ever named this matter. That is a different state from a check that ran and
      surfaced nothing, and neither of them is a statement about the matter itself.
    </EmptyState>
  {/snippet}
  {#snippet fixture()}
    <section class="flex flex-col gap-8">
      <FieldLabel as="h3">Open Questions</FieldLabel>
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact(evidenceTier(1).label, "2")}
        {@render fact(evidenceTier(2).label, "1")}
        {@render fact(evidenceTier(3).label, "0")}
        {@render fact(evidenceTier(4).label, "0")}
      </dl>
    </section>
    <section class="flex flex-col gap-8 border-t border-border-default pt-12">
      <FieldLabel as="h3">The Latest Check</FieldLabel>
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact("Run", sampleDate(0))}
        {@render fact("Trigger", triggerVocabulary("comprehensive").label)}
        {@render fact("Run By", samplePerson(0).name)}
        {@render fact("Subject Parties", "4")}
        {@render fact("Entities Reached", "31")}
        {@render fact("Candidates", "3")}
      </dl>
    </section>
    <section class="flex flex-col gap-8 border-t border-border-default pt-12">
      <FieldLabel as="h3">Re-checks Owed</FieldLabel>
      <EventRail events={RECHECK_FIXTURE} label="Re-checks this matter is owed" />
      <dl class="flex flex-col gap-4 text-sm">
        {@render fact("Scheduled Re-screening", "Every 30 days")}
        {@render fact("Last Scheduled Pass", sampleDate(1))}
      </dl>
    </section>
  {/snippet}
  {#if posture !== null}
    <section class="flex flex-col gap-8">
      <div class="flex flex-wrap items-center justify-between gap-16">
        <FieldLabel as="h3">Open Questions</FieldLabel>
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
        <FieldLabel as="h3">Answered</FieldLabel>
        <dl class="flex flex-col gap-4 text-sm">
          {#each posture.dispositionsByKind as entry (entry.kind)}
            {@const word = dispositionVocabulary(entry.kind)}
            <div class="flex items-baseline justify-between gap-16">
              <dt class="text-text-muted" title={word.meaning}>{word.label}</dt>
              <dd class="text-right">
                {String(entry.count)} &middot; {entry.reviewerUserIds
                  .map((userId) => memberText(userId))
                  .join(", ")}
                <!-- A matter reported as carrying three waivers, two of which the firm cannot
                     evidence, is not the matter "three waivers" describes. The count says which. -->
                {#if entry.incompleteCount > 0}
                  <span class="text-text-muted">
                    &middot; {String(entry.incompleteCount)} the platform cannot produce the record for
                  </span>
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/if}

    {#if latest !== null}
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <FieldLabel as="h3">The Latest Check</FieldLabel>
        <dl class="flex flex-col gap-4 text-sm">
          {#if latest.checkNumber !== null}
            {@render fact("Check", latest.checkNumber, "The number the firm refers to this check by.")}
          {/if}
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
            {latest.checkNumber === null ? "Read the check" : `Read ${latest.checkNumber}`}
          </a>
        {/if}
      </section>

      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <FieldLabel as="h3">What It Searched</FieldLabel>
        <ScopeInForce scope={latest.scope} />
      </section>
    {/if}

    {#if posture.scopeShortfall.sources.length > 0 || posture.scopeShortfall.strictness !== null}
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <FieldLabel as="h3">Below The Firm's Current Policy</FieldLabel>
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
        </dl>
      </section>
    {/if}

    {#if posture.unavailableSources.length > 0}
      <section class="flex flex-col gap-8 border-t border-border-default pt-12">
        <FieldLabel as="h3">Could Not Be Searched</FieldLabel>
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
        <FieldLabel as="h3">Re-checks Owed</FieldLabel>
        <!-- Whatever the surface offers here — asking for a re-check now, most of the time. It is
             the page's to supply: this panel reports where a matter stands and performs nothing. -->
        {#if recheckAction}{@render recheckAction()}{/if}
      </div>
      <EventRail
        events={pendingEvents}
        label="Re-checks this matter is owed"
        emptyMessage="The platform knows of no corpus change since the last check that would have changed its answer."
      />
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
  {/if}
</LoadingRegion>
