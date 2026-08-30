<script lang="ts">
  /*
   * One surfaced candidate, opened — where a reviewer finds out WHY it matched, against whom, and
   * through what, and then answers it.
   *
   * A hit a lawyer cannot explain is a hit they cannot act on, so the window's whole job is to put
   * the explanation in front of them rather than a score. Three tabs, and each answers a different
   * question a reviewer actually asks: what matched, how it was reached, and who has said what
   * about it.
   *
   * THE RECORD IS NOT EDITABLE, EVER. The conflicts log is append-only at the database, so Edit
   * renders refused and says why rather than disappearing. Answering the hit is a different act and
   * it appends a row of its own.
   *
   * A WAIVER'S RECORD IS SHOWN FIELD BY FIELD, AND SO IS WHAT IT IS MISSING. Recording that a waiver
   * was obtained now records who consented, whether the consent was confirmed in writing, the filed
   * document evidencing it, and when it was given. The platform accepts a waiver whose writing has
   * not arrived, because that is a real thing that happens — and then says, here and on every other
   * surface, exactly what it could not produce if somebody asked for it this afternoon.
   *
   * THE PARTY'S NAME IS READ FOR THIS HIT ALONE. The check answers entity handles and nothing about
   * them, and no read names many entities at once, so the list states the gap and this window
   * spends one request on the hit somebody actually opened.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EventRail from "@magna-carta/design-system/event-rail";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import Separator from "@magna-carta/design-system/separator";
  import { formatInstant, personName } from "@magna-carta/design-system/formatters";
  import type { EventRailEvent } from "@magna-carta/design-system/event-rail";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Gavel from "@lucide/svelte/icons/gavel";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { soonControlProperties } from "$lib/maturity/soon-affordance.ts";
  import { gapCellTitle, gapReason } from "./conflicts-gaps.ts";
  import { hitSheet } from "./conflicts-report.ts";
  import type { HitDetail } from "./conflicts-api.ts";
  import {
    adjudicationSummary,
    edgeTypeLabel,
    evidenceTier,
    pathSummary,
    sourceVocabulary,
    waiverShortfallText,
  } from "./conflicts-vocabulary.ts";
  import { entityRecordHref } from "$lib/directory/entity-presentation.ts";
  import { entityKindText, surfacedAgainstText } from "./hit-columns.ts";

  let {
    open = $bindable(false),
    hit,
    partyName = null,
    partyNameFailed = false,
    consentingPartyName = null,
    reviewerName = null,
    checkInstant,
    onAnswer,
  }: {
    open?: boolean;
    hit: HitDetail | null;
    /** The matched party's name, once one read has answered it. */
    partyName?: string | null;
    /** True when the read ran and could not name the entity, which is not the same as not asked. */
    partyNameFailed?: boolean;
    /**
     * The name of the entity that gave the waiver, once one read has answered it. Null where the
     * disposition names none, or where the read has not returned — the handle prints either way, so
     * a reader is never left with a blank where a consenting party belongs.
     */
    consentingPartyName?: string | null;
    /** The reviewer's name, resolved from the firm's roster. */
    reviewerName?: string | null;
    /** When the check that surfaced this hit ran. */
    checkInstant: string;
    /** Take the reviewer into answering it. */
    onAnswer: () => void;
  } = $props();

  const trailDescription = $props.id();
  const soonTrail = soonControlProperties(gapReason("adjudicationTrail"), trailDescription);

  const EDIT_REFUSAL =
    "The conflicts log is append-only. A hit is never edited; answering it records a new row.";

  const heading = $derived(
    partyName ?? (partyNameFailed ? "Party could not be named" : "Reading the party"),
  );

  /**
   * The history this window can honestly show: the check that surfaced the hit, and the reviewer's
   * latest word on it. Every earlier answer is on the record and nothing reads it back yet, which
   * is stated beneath the rail rather than left as an absence.
   */
  const events = $derived.by((): EventRailEvent[] => {
    if (hit === null) return [];
    const rail: EventRailEvent[] = [
      {
        id: `${hit.id}-surfaced`,
        action: "Surfaced by the check",
        at: hit.createdAt,
        source: "The conflicts engine",
        detail: hit.matchedFields.join("; "),
      },
    ];
    if (hit.disposition !== null) {
      rail.push({
        id: hit.disposition.id,
        // The summary rather than the bare kind: on the trail as everywhere else, an answer whose
        // record the platform cannot produce must not read as one it can.
        action: adjudicationSummary(hit.disposition).label,
        at: hit.disposition.createdAt,
        source: personName(reviewerName),
        detail: hit.disposition.rationale,
      });
    }
    return rail;
  });

  let printOpen = $state(false);
  const sheet = $derived(
    hit === null
      ? null
      : hitSheet(hit, {
          partyName,
          consentingPartyName,
          reviewerName,
          checkInstant,
          printedAt: new Date(),
        }),
  );
</script>

{#snippet subtitle()}
  {#if hit !== null}
    {evidenceTier(hit.evidenceTier).label} &middot; {sourceVocabulary(hit.sourceClass).label}
  {/if}
{/snippet}

{#snippet fact(label: string, value: string, title?: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-text-muted">{label}</dt>
    <dd class="text-right" {title}>{value}</dd>
  </div>
{/snippet}

{#snippet record()}
  {#if hit !== null}
    {@const chip = adjudicationSummary(hit.disposition)}
    <div class="flex flex-col gap-16">
      <div class="flex flex-wrap items-center gap-8">
        <Badge variant={chip.tone} title={chip.meaning}>{chip.label}</Badge>
        {#if hit.coParty}
          <Badge variant="neutral" title="This match landed on a subject party of this same check.">
            {surfacedAgainstText(hit)}
          </Badge>
        {/if}
      </div>

      <dl class="flex flex-col gap-4 text-sm">
        <div class="flex items-baseline justify-between gap-16">
          <dt class="text-text-muted">Party</dt>
          <dd class="text-right">
            {#if partyName === null}
              <span title={gapCellTitle("matchedPartyName")}>
                {partyNameFailed ? "Not named" : "Reading"}
              </span>
            {:else}
              <!-- The entity's own record, so a reviewer can read what the firm holds about it
                   rather than taking the hit's word for who it is. -->
              <a class="underline underline-offset-2" href={entityRecordHref(hit.entityId)}>
                {partyName}
              </a>
            {/if}
          </dd>
        </div>
        {@render fact("Kind", entityKindText(hit.entityId))}
        {@render fact("Tier", evidenceTier(hit.evidenceTier).label, evidenceTier(hit.evidenceTier).meaning)}
        {@render fact(
          "Source",
          sourceVocabulary(hit.sourceClass).label,
          sourceVocabulary(hit.sourceClass).meaning,
        )}
        {@render fact("Surfaced Against", surfacedAgainstText(hit))}
        {@render fact("Reached Through", pathSummary(hit.graphPath))}
        {@render fact("Surfaced", formatInstant(hit.createdAt))}
      </dl>

      {#if hit.disposition !== null}
        <Separator />
        <div class="flex flex-col gap-8">
          <h3 class="text-xs text-text-subtle uppercase">Latest Answer</h3>
          <p class="text-sm">{hit.disposition.rationale}</p>
          <p class="text-xs text-text-muted">
            {personName(reviewerName)} &middot; {formatInstant(hit.disposition.createdAt)}
          </p>
        </div>
      {/if}

      {#if hit.disposition !== null && hit.disposition.kind === "waiver_obtained"}
        {@const waiver = hit.disposition.waiver}
        <Separator />
        <!-- The waiver's own record, which is the thing a firm is actually asked to produce. It is
             stated field by field rather than summarized: a reader has to be able to see WHICH part
             is missing, because "no document filed" and "consent never confirmed in writing" send a
             lawyer to do two different things. -->
        <div class="flex flex-col gap-8">
          <h3 class="text-xs text-text-subtle uppercase">The Waiver</h3>
          <dl class="flex flex-col gap-4 text-sm">
            {@render fact(
              "Given By",
              waiver?.givenByEntityId == null
                ? "Not recorded"
                : (consentingPartyName ?? waiver.givenByEntityId),
            )}
            {@render fact(
              "Confirmed In Writing",
              waiver?.confirmedInWriting == null
                ? "Not recorded"
                : waiver.confirmedInWriting
                  ? "Yes"
                  : "No",
            )}
            {@render fact(
              "Evidencing Document",
              waiver?.documentFileId ?? "Not filed",
            )}
            {@render fact("Given On", waiver?.givenOn ?? "Not recorded")}
          </dl>
          {#if hit.disposition.shortfalls.length > 0}
            <ul class="flex flex-col gap-4 text-xs text-text-muted">
              {#each hit.disposition.shortfalls as shortfall (shortfall)}
                <li class="flex items-start gap-8">
                  <CircleAlert class="size-12 shrink-0" aria-hidden="true" />
                  <span>{waiverShortfallText(shortfall)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet evidenceTab()}
  {#if hit !== null}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <h3 class="text-xs text-text-subtle uppercase">Every Channel That Fired</h3>
        <!-- Verbatim, and every one of them: the engine records each comparison that matched rather
             than only the one that set the tier, because that is what a reviewer adjudicates on and
             what an auditor reads years later. -->
        <ul class="flex flex-col gap-4 text-sm">
          {#each hit.matchedFields as field, index (`${field}-${String(index)}`)}
            <li>{field}</li>
          {:else}
            <li class="text-text-muted">
              No channel is recorded on this hit, which is why it sits at the weakest tier.
            </li>
          {/each}
        </ul>
      </div>
      <div class="flex items-start gap-8 text-sm text-text-muted">
        <CircleAlert class="size-16 shrink-0" aria-hidden="true" />
        <span>{evidenceTier(hit.evidenceTier).meaning}</span>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet pathTab()}
  {#if hit !== null}
    <div class="flex flex-col gap-16">
      {#if hit.graphPath.length === 0}
        <p class="text-sm text-text-muted">
          Matched directly. No relationship was traversed to reach this entity.
        </p>
      {:else}
        <ol class="flex flex-col gap-12 text-sm">
          {#each hit.graphPath as step, index (step.edgeId)}
            <li class="flex flex-col gap-4">
              <span class="font-semibold">
                {String(index + 1)}. {edgeTypeLabel(step.edgeType)}
              </span>
              <span class="text-text-muted break-all">
                {step.fromEntityId} &rarr; {step.toEntityId}
              </span>
              {#if step.expiredAtCheck === true}
                <span>
                  <Badge
                    variant="neutral"
                    title="The relationship had already ended when the check read the corpus. It is traversed rather than skipped, because the rules that most often decide a conflict are about former relationships."
                  >
                    Ended before the check
                  </Badge>
                </span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet adjudicationTab()}
  <div class="flex h-full min-h-0 flex-col gap-8">
    <EventRail
      {events}
      label="This hit's adjudication"
      emptyMessage="Nothing has been recorded against this hit yet."
    />
    {#if hit?.disposition != null && hit.disposition.shortfalls.length > 0}
      <!-- Beneath the trail, because it is not an event: it is what the latest answer's record is
           still short of, and it stays true until a second disposition supplies it. -->
      <div class="flex flex-col gap-4 text-xs text-text-muted">
        {#each hit.disposition.shortfalls as shortfall (shortfall)}
          <p class="flex items-start gap-8">
            <CircleAlert class="size-12 shrink-0" aria-hidden="true" />
            <span>{waiverShortfallText(shortfall)}</span>
          </p>
        {/each}
      </div>
    {/if}
    <div class="flex items-center gap-8">
      <MaturityBadge stage="soon" />
      <p id={trailDescription} class="text-xs text-text-muted">{soonTrail.title}</p>
    </div>
  </div>
{/snippet}

{#snippet actions()}
  <span class="mr-auto flex items-center gap-4 text-xs text-text-muted">
    <Gavel class="size-12" aria-hidden="true" />
    An answer names whoever records it.
  </span>
  <Button variant="secondary" onclick={() => (open = false)}>Close</Button>
  <Button variant="primary" onclick={onAnswer}>Answer this hit</Button>
{/snippet}

<RecordWindow
  bind:open
  {heading}
  {subtitle}
  {record}
  {actions}
  tabs={[
    { key: "evidence", label: "Evidence", count: hit?.matchedFields.length },
    { key: "path", label: "Path", count: hit?.graphPath.length },
    { key: "adjudication", label: "Adjudication" },
  ].map((tab) => ({
    ...tab,
    content:
      tab.key === "evidence" ? evidenceTab : tab.key === "path" ? pathTab : adjudicationTab,
  })) satisfies RecordWindowTab[]}
  defaultTab="evidence"
  editDisabledReason={EDIT_REFUSAL}
  onEdit={() => undefined}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
