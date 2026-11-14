<script lang="ts">
  /*
   * Where a matter stands on conflicts, in counts: what no reviewer has answered yet, by how strong
   * the evidence is; what has been answered, and by whom; and what the latest check could not
   * search or searched below the firm's current policy.
   *
   * THERE IS NO VERDICT HERE, AND THERE IS NOTHING TO ADD ONE TO. The read this renders has no
   * aggregate and no summary field by design: the platform reports what it searched, what it could
   * not search, and what no reviewer has answered, because a firm defending a disqualification
   * motion defends a PROCEDURE and cannot defend a conclusion its software drew. So this states
   * facts and counts, and the only thing it makes loud is an open question or a gap.
   *
   * A GAP IS TINTED, the way the check's own report tints what it did not search, so a shortfall
   * stands out from what ran (owner's ruling on the check screen, 2026-11-13).
   *
   * STALENESS IS COMPUTED, NOT STORED. The shortfall against the firm's current policy is derived
   * at read time, so raising the firm's floor shows up here immediately.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { personName } from "@magna-carta/design-system/formatters";
  import type { MatterConflictsPosture } from "./conflicts-api.ts";
  import { STRENGTH_LABELS } from "./check-results.ts";
  import {
    dispositionVocabulary,
    evidenceTier,
    sourceVocabulary,
    strictnessVocabulary,
  } from "./conflicts-vocabulary.ts";

  let {
    posture,
    memberNames,
  }: {
    posture: MatterConflictsPosture;
    /** Member names by account handle, so a reviewer is a person rather than a handle. */
    memberNames: ReadonlyMap<string, string>;
  } = $props();

  function memberText(userId: string): string {
    return personName(memberNames.get(userId) ?? null, { whenUnrecorded: userId });
  }

  const shortfall = $derived(posture.scopeShortfall);
  const belowPolicy = $derived(shortfall.sources.length > 0 || shortfall.strictness !== null);
</script>

<div class="flex flex-col gap-16 text-sm">
  <section class="flex flex-col gap-8">
    <FieldLabel as="h4">Not Reviewed, By Strength</FieldLabel>
    <!-- All four, zero included: an absent strength would read as nothing to say, and the point of
         this block is that an unanswered question is stated out loud. -->
    <dl class="grid grid-cols-2 gap-8 sm:grid-cols-4">
      {#each posture.undisposedByTier as entry (entry.tier)}
        <div
          class="flex min-w-0 flex-col gap-2 rounded-md bg-surface-sunken p-12"
          title={evidenceTier(entry.tier).meaning}
          data-tier={entry.tier}
        >
          <dt class="text-text-muted">{STRENGTH_LABELS[entry.tier]}</dt>
          <dd class="text-xl font-semibold tabular-nums">{String(entry.count)}</dd>
        </div>
      {/each}
    </dl>
  </section>

  {#if posture.dispositionsByKind.length > 0}
    <section class="flex flex-col gap-8">
      <FieldLabel as="h4">Answered</FieldLabel>
      <ul class="flex flex-col gap-4">
        {#each posture.dispositionsByKind as entry (entry.kind)}
          {@const word = dispositionVocabulary(entry.kind)}
          <li>
            <span class="font-semibold" title={word.meaning}>{word.label}</span>
            <span class="tabular-nums">{String(entry.count)}</span>, by
            {entry.reviewerUserIds.map((userId) => memberText(userId)).join(", ")}.
            <!-- A matter reported as carrying three waivers, two of which the firm cannot evidence,
                 is not the matter "three waivers" describes. The count says which. -->
            {#if entry.incompleteCount > 0}
              <span class="text-text-muted">
                Magna Carta can't produce the record for {String(entry.incompleteCount)}.
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if belowPolicy}
    <section
      class="flex flex-col gap-4 rounded-md bg-status-warning-subtle p-12 text-status-warning-subtle-foreground"
      data-section="below-policy"
    >
      <FieldLabel as="h4">Below The Firm's Current Policy</FieldLabel>
      {#if shortfall.sources.length > 0}
        <p>
          The firm's policy now requires {shortfall.sources
            .map((source) => sourceVocabulary(source).label)
            .join(", ")}, and the latest check didn't include {shortfall.sources.length === 1
            ? "it"
            : "them"}.
        </p>
      {/if}
      {#if shortfall.strictness !== null}
        <p>
          It ran under {strictnessVocabulary(shortfall.strictness.ranUnder).label} name matching. The
          firm's floor is now {strictnessVocabulary(shortfall.strictness.firmFloor).label}.
        </p>
      {/if}
    </section>
  {/if}

  {#if posture.unavailableSources.length > 0}
    <section
      class="flex flex-col gap-4 rounded-md bg-status-warning-subtle p-12 text-status-warning-subtle-foreground"
      data-section="could-not-search"
    >
      <FieldLabel as="h4">Couldn't Be Searched</FieldLabel>
      {#each posture.unavailableSources as entry (entry.source)}
        <p><span class="font-semibold">{sourceVocabulary(entry.source).label}.</span> {entry.reason}</p>
      {/each}
    </section>
  {/if}
</div>
