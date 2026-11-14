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
   * renders refused and says why rather than disappearing, and this window hands the shell no way
   * to commit a change — which is the other half of the same refusal. Answering the hit is a
   * different act and it appends a row of its own.
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
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { SAMPLE_SENTENCE, sampleInstant, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Gavel from "@lucide/svelte/icons/gavel";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { hitSheet } from "./conflicts-report.ts";
  import {
    readConflictsDispositionTrail,
    type DispositionTrailEntry,
    type HitDetail,
  } from "./conflicts-api.ts";
  import {
    adjudicationSummary,
    dispositionVocabulary,
    edgeTypeLabel,
    evidenceTier,
    pathSummary,
    sourceVocabulary,
    waiverShortfallText,
  } from "./conflicts-vocabulary.ts";
  import EntityWindow from "$lib/directory/entity-window.svelte";
  import { entityKindText, partyCellTitle, partyText, surfacedAgainstText } from "./hit-columns.ts";

  let {
    open = $bindable(false),
    hit,
    consentingPartyName = null,
    reviewerName = null,
    checkInstant,
    onAnswer,
  }: {
    open?: boolean;
    hit: HitDetail | null;
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

  const EDIT_REFUSAL =
    "Results are never edited. Answering a result adds a new entry.";

  // The matched party comes ON the hit — the check read resolves every hit's entity — so this window
  // takes no name of its own to be told. It used to, and a caller could hand it one that disagreed
  // with the hit it was showing.
  const partyName = $derived(hit?.party?.displayName ?? null);

  // The party's directory record, opened over this window rather than in the directory's place:
  // a reviewer reads what the firm holds about the entity and comes back to the hit they were on.
  let entityOpen = $state(false);
  let openEntityId = $state("");

  function openParty(): void {
    if (hit === null) return;
    openEntityId = hit.entityId;
    entityOpen = true;
  }
  const heading = $derived(partyName ?? (hit === null ? "" : partyText(hit)));

  /*
   * The whole adjudication trail, read when the window opens.
   *
   * This used to be the check that surfaced the hit plus the reviewer's LATEST word, with a line
   * underneath saying the earlier answers were on the record and unreadable. They are readable now,
   * and that matters more here than anywhere else on the surface: the log is append-only precisely
   * so that a reviewer who cleared a hit and later reversed leaves both acts standing, and a rail
   * showing only the surviving one would hide the history the table refuses to destroy.
   */
  let trail = $state<DispositionTrailEntry[]>([]);
  let trailFailure = $state<StatedFailure | null>(null);
  let trailLoading = $state(false);

  /** Read the trail for the hit the window is holding. Retry asks again for the same hit. */
  function readTrail(): void {
    const hitId = hit?.id ?? null;
    if (hitId === null) return;
    trail = [];
    trailFailure = null;
    trailLoading = true;
    void (async () => {
      const outcome = await readConflictsDispositionTrail(fetch, hitId);
      // A hit the reviewer has already moved past says nothing about this window.
      if ((hit?.id ?? null) !== hitId) return;
      trailLoading = false;
      if (outcome.kind === "ok") {
        trail = outcome.value.dispositions;
        return;
      }
      trailFailure = stated(outcome.failure, "Couldn't load this result's answers.");
    })();
  }

  $effect(() => {
    const hitId = hit?.id ?? null;
    if (!open || hitId === null) return;
    readTrail();
  });

  /*
   * The shape the trail takes while it is being read: the same rail, over invented answers from
   * the sample vocabulary. It is inert and hidden from assistive technology while it stands, so
   * nothing in it can be mistaken for a real hit's record.
   */
  const TRAIL_FIXTURE: readonly EventRailEvent[] = [
    {
      id: "fixture-surfaced",
      action: "Found by the check",
      at: sampleInstant(1),
      source: "The conflicts engine",
      detail: "Surname and given name matched; date of birth matched",
    },
    {
      id: "fixture-cleared",
      action: "Cleared: no adverse interest",
      at: sampleInstant(0),
      source: samplePerson(0).name,
      detail: SAMPLE_SENTENCE,
    },
    {
      id: "fixture-waiver",
      action: "Waiver obtained, confirmed in writing",
      at: sampleInstant(4),
      source: samplePerson(0).name,
      detail: SAMPLE_SENTENCE,
    },
  ];

  const events = $derived.by((): EventRailEvent[] => {
    if (hit === null) return [];
    const rail: EventRailEvent[] = [
      {
        id: `${hit.id}-surfaced`,
        action: "Found by the check",
        at: hit.createdAt,
        source: "The conflicts engine",
        detail: hit.matchedFields.join("; "),
      },
    ];
    for (const entry of trail) {
      rail.push({
        id: entry.id,
        // The summary rather than the bare kind: on the trail as everywhere else, an answer whose
        // record the platform cannot produce must not read as one it can.
        action: adjudicationSummary(entry).label,
        at: entry.createdAt,
        // Only the LATEST answer's reviewer is resolved to a name by the caller; an earlier one
        // prints the handle rather than borrowing a name that belongs to a different act.
        source:
          entry.id === hit.disposition?.id ? personName(reviewerName) : entry.reviewerUserId,
        detail: entry.rationale,
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
              <span title={partyCellTitle(hit)}>{partyText(hit)}</span>
            {:else}
              <!-- The entity's own record, so a reviewer can read what the firm holds about it
                   rather than taking the hit's word for who it is. -->
              <button type="button" class="underline underline-offset-2" onclick={openParty}>
                {partyName}
              </button>
            {/if}
          </dd>
        </div>
        {#if hit.previouslyAnswered !== null}
          <!--
            CONTEXT, and never this hit's answer. The firm has said something about this party
            before; whether it answers THIS question is the reviewer's judgment, not the machine's.
            The case that decides it: a company cleared as a FORMER client can re-surface as the
            subsidiary of a CURRENT one — same party, a different question, on a higher bar. So the
            hit stays unanswered, nothing is pre-filled, and the earlier check is linked so a
            reviewer can read it rather than take this line's word for it.
          -->
          <div class="flex items-baseline justify-between gap-16">
            <dt class="text-text-muted">Answered Before</dt>
            <dd class="flex flex-wrap justify-end gap-x-8 text-right">
              <span>
                {dispositionVocabulary(hit.previouslyAnswered.kind).label} on
                {formatInstant(hit.previouslyAnswered.createdAt)}
              </span>
              <a
                class="underline underline-offset-2"
                href="/conflicts/checks/{hit.previouslyAnswered.checkId}"
              >
                Open that check
              </a>
            </dd>
          </div>
          <p class="text-xs text-text-subtle">
            About the same party, on an earlier check. You decide whether it applies here. This result is unanswered until you answer it.
          </p>
        {/if}
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
          <FieldLabel as="h3">Latest Answer</FieldLabel>
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
          <FieldLabel as="h3">The Waiver</FieldLabel>
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
        <FieldLabel as="h3">Every Search That Matched</FieldLabel>
        <!-- Verbatim, and every one of them: the engine records each comparison that matched rather
             than only the one that set the tier, because that is what a reviewer adjudicates on and
             what an auditor reads years later. -->
        <ul class="flex flex-col gap-4 text-sm">
          {#each hit.matchedFields as field, index (`${field}-${String(index)}`)}
            <li>{field}</li>
          {:else}
            <li class="text-text-muted">
              No search is recorded on this result, so it's shown as the weakest match.
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
                    title="This relationship had already ended when the check ran. It's still followed, because former relationships often decide a conflict."
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

{#snippet trailRail(note?: string)}
  <!-- The one line about the trail sits INSIDE the rail's frame, beneath its events, so the words
       about what the record holds (or does not yet) are never loose prose beside the structure. -->
  <EventRail
    {events}
    label="This hit's adjudication"
    emptyMessage="Nothing has been recorded against this hit yet."
    {note}
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
{/snippet}

{#snippet adjudicationTab()}
  <div class="flex h-full min-h-0 flex-col gap-8">
    <LoadingRegion
      loading={trailLoading}
      failed={trailFailure !== null}
      empty={trail.length === 0}
      label="Reading all answers on this result"
      onRetry={readTrail}
      class="flex min-h-0 flex-1 flex-col gap-8"
    >
      {#snippet failure()}
        <!-- A trail that could not be read says so, under the rail's one certain event. An
             append-only record that silently showed fewer acts than it holds would be the one
             failure this whole surface exists to prevent. -->
        {@render trailRail()}
        {#if trailFailure !== null}
          <FailureNotice
            failure={trailFailure.failure}
            subject="This hit's answers"
            fallback={trailFailure.fallback}
            onRetry={readTrail}
          />
        {/if}
      {/snippet}
      {#snippet fixture()}
        <EventRail
          events={TRAIL_FIXTURE}
          label="This hit's adjudication"
          note="2 answers, oldest first. Answers are never edited; a reviewer who changes their mind records a new one, and both are kept."
        />
      {/snippet}
      {#snippet emptyState()}
        <!-- An empty trail still has the rail's one certain event on it: the check that surfaced
             the hit. What is empty is the reviewers' side of the record, and the rail's own note
             says so. -->
        {@render trailRail(
          "No reviewer has answered this result yet. That says nothing about whether an interest is adverse.",
        )}
      {/snippet}
      <!-- The point of the trail: a later answer never replaces an earlier one on the record. -->
      {@render trailRail(
        trail.length > 1
          ? `${String(trail.length)} answers, oldest first. Answers are never edited; a reviewer who changes their mind records a new one, and both are kept.`
          : undefined,
      )}
    </LoadingRegion>
  </div>
{/snippet}

{#snippet actions()}
  <span class="mr-auto flex items-center gap-4 text-xs text-text-muted">
    <Gavel class="size-12" aria-hidden="true" />
    Each answer names the person who records it.
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
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}

<EntityWindow bind:open={entityOpen} bind:entityId={openEntityId} />
