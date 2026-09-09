<script lang="ts">
  /*
   * The New Check panel's RIGHT pane: the engine's own settings.
   *
   * The owner's direction, 2026-09-08: "we need more modular control, rather than these one off
   * buttons… left would be general information, right would be advanced and technical settings…
   * right side is the engine settings." And, on the settings themselves: "you have so many settings
   * and i don't know what half of them mean, meaning we need better naming."
   *
   * SO EVERY CONTROL SAYS WHAT IT SEARCHES, IN PLACE. A hover title is not a label — it does not
   * exist on a touch device and a screen reader reaches it only by asking — and every one of these
   * settings is a fact about a search nobody can watch run. Each therefore carries a line of its
   * own under it, in the reader's words, and the words are the ones in conflicts-vocabulary.ts so
   * this pane and the log's own columns cannot come to call the same thing two things.
   *
   * THE FOUR GROUPS, IN THE ORDER A SEARCH USES THEM: where to look, how names are compared, how
   * far relationships are followed, and where the walk stops. The middle one is where sound-alike
   * matching lives, and it says so out loud rather than hiding inside a word like "strictness" —
   * which is what the owner was asking about when they asked what strictness searched for.
   *
   * A NUMBER LEFT BLANK IS THE FIRM'S OWN, and each field says so where the field is: the firm's
   * setting is the placeholder inside the box. The panel used to state that once, at the bottom,
   * over a block reading "Firm floor · Party · Balanced · depth 1 · closure cap 500" — four facts
   * in a shorthand nobody who had not built the engine could read.
   *
   * WHAT THE FIRM REQUIRES IS DIFFERENT FROM WHAT IT DEFAULTS TO, and only the first is a floor: a
   * narrower choice of SOURCES or of name matching is raised back up before the search runs, and
   * the check records that it was raised. The bounds below are defaults and may genuinely be run
   * narrower. The line at the head of this pane is the one place that distinction is stated.
   */
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import { MaturityBadge, soonControlProperties } from "@magna-carta/design-system/maturity";
  import type { FirmConflictsPolicy } from "./conflicts-api.ts";
  import type { CheckDraft } from "./check-draft.svelte.ts";
  import {
    CANDIDATE_LIMIT_LABEL,
    RELATED_PARTY_LIMIT_LABEL,
  } from "./check-request.ts";
  import {
    BUDGETED_EDGE_CLASSES,
    EDGE_CLASS_VOCABULARY,
    NAME_MATCHING_LABEL,
    SOURCE_VOCABULARY,
    STRICTNESS_LEVELS,
    STRICTNESS_VOCABULARY,
    edgeClassLabel,
    sourceVocabulary,
    strictnessVocabulary,
  } from "./conflicts-vocabulary.ts";

  let {
    draft,
    policy = null,
    matterNamed = false,
    busy = false,
  }: {
    draft: CheckDraft;
    /** The firm's own policy, read so a blank field can show the number it will take. */
    policy?: FirmConflictsPolicy | null;
    /** Whether the check names a matter. Without one there is nothing to impute against. */
    matterNamed?: boolean;
    busy?: boolean;
  } = $props();

  const fieldPrefix = $props.id();
  const ownPeopleDescription = `${fieldPrefix}-own-people`;
  const contentDescription = `${fieldPrefix}-content`;

  /** What the document-and-message source waits on. A standing fact about the platform. */
  const CONTENT_DEPENDENCY =
    "an index over document text and a wired message-body index, neither of which exists";

  const soonContent = soonControlProperties(CONTENT_DEPENDENCY, contentDescription);

  /** A bound's placeholder: the firm's own number, so a blank box says what it will take. */
  function firmNumber(value: number | undefined): string {
    return value === undefined ? "The firm's own" : String(value);
  }

  const floorSentence = $derived.by(() => {
    if (policy === null) return null;
    const sources = policy.floorSources.map((source) => sourceVocabulary(source).label).join(", ");
    const band = strictnessVocabulary(policy.floorStrictness).label.toLowerCase();
    return `This firm requires every check to search ${sources} at ${band} name matching or wider. A narrower choice here is raised back up before the search runs, and the check records that it was raised.`;
  });
</script>

<div class="flex flex-col gap-24">
  <section class="flex flex-col gap-8">
    <FieldLabel as="h4">Search Settings</FieldLabel>
    <p class="text-xs text-text-muted">
      How widely the engine searches. Everything here can be left alone.
    </p>
    {#if floorSentence !== null}
      <p class="text-xs text-text-muted">{floorSentence}</p>
    {/if}
  </section>

  <section class="flex flex-col gap-12 border-t border-border-default pt-16">
    <FieldLabel as="h4">Where To Look</FieldLabel>

    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-8">
        <Checkbox
          id="{fieldPrefix}-source-party"
          checked
          disabled
          title="Every check searches this. It is the firm-wide floor rather than a choice."
        />
        <Label for="{fieldPrefix}-source-party">{SOURCE_VOCABULARY.party?.label}</Label>
      </div>
      <p class="text-xs text-text-muted">{SOURCE_VOCABULARY.party?.meaning}</p>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-8">
        <Checkbox
          id="{fieldPrefix}-source-graph"
          bind:checked={draft.searchRelationships}
          disabled={busy}
        />
        <Label for="{fieldPrefix}-source-graph">{SOURCE_VOCABULARY.graph?.label}</Label>
      </div>
      <p class="text-xs text-text-muted">{SOURCE_VOCABULARY.graph?.meaning}</p>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-8">
        <Checkbox
          id="{fieldPrefix}-source-imputation"
          bind:checked={draft.searchOwnPeople}
          disabled={busy || !matterNamed}
          aria-describedby={ownPeopleDescription}
        />
        <Label for="{fieldPrefix}-source-imputation">{SOURCE_VOCABULARY.imputation?.label}</Label>
      </div>
      <p id={ownPeopleDescription} class="text-xs text-text-muted">
        {SOURCE_VOCABULARY.imputation?.meaning}{matterNamed
          ? ""
          : " No matter is named, so this check records it as not searched."}
      </p>
    </div>

    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-8">
        <Checkbox id="{fieldPrefix}-source-content" checked={false} {...soonContent} />
        <Label for="{fieldPrefix}-source-content">{SOURCE_VOCABULARY.content?.label}</Label>
        <MaturityBadge stage="soon" />
      </div>
      <p id={contentDescription} class="text-xs text-text-muted">{soonContent.title}</p>
    </div>
  </section>

  <section class="flex flex-col gap-12 border-t border-border-default pt-16">
    <FieldLabel as="h4" id="{fieldPrefix}-name-matching">{NAME_MATCHING_LABEL}</FieldLabel>
    <!-- Named rather than left to a word: sound-alike matching is on in both bands, and a reader
         asking whether the firm can find Stephen from Steven should not have to open a tooltip. -->
    <p class="text-xs text-text-muted">
      How many ways a name may be written and still count. Both settings match names that SOUND
      alike — Stephen and Steven, Mohammed and Muhammad — and widening only ever adds candidates.
    </p>
    <RadioGroup.Root
      bind:value={draft.nameMatching}
      aria-labelledby="{fieldPrefix}-name-matching"
      disabled={busy}
    >
      {#each STRICTNESS_LEVELS as level (level)}
        {@const word = STRICTNESS_VOCABULARY[level]}
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-8">
            <RadioGroup.Item value={level} id="{fieldPrefix}-name-matching-{level}" />
            <Label for="{fieldPrefix}-name-matching-{level}">{word.label}</Label>
          </div>
          <p class="text-xs text-text-muted">{word.meaning}</p>
        </div>
      {/each}
    </RadioGroup.Root>
  </section>

  <section class="flex flex-col gap-12 border-t border-border-default pt-16">
    <FieldLabel as="h4">How Far To Follow Relationships</FieldLabel>
    <p class="text-xs text-text-muted">
      How many relationships the search may walk through, counted separately for each kind: one
      number cannot say "follow a rename chain forever, but do not walk from a spouse to her
      employer's other directors".
    </p>

    {#each BUDGETED_EDGE_CLASSES as edgeClass (edgeClass)}
      <div class="flex flex-col gap-4">
        <Label for="{fieldPrefix}-hops-{edgeClass}">{edgeClassLabel(edgeClass)}</Label>
        <Input
          id="{fieldPrefix}-hops-{edgeClass}"
          type="number"
          min="0"
          max="6"
          inputmode="numeric"
          placeholder={firmNumber(policy?.edgeClassBudgets[edgeClass] ?? policy?.defaultDepth)}
          disabled={busy || !draft.searchRelationships}
          value={draft.relationshipHops[edgeClass]}
          oninput={(event) => draft.setHops(edgeClass, event.currentTarget.value)}
        />
        <p class="text-xs text-text-muted">{EDGE_CLASS_VOCABULARY[edgeClass]?.meaning}</p>
      </div>
    {/each}

    <div class="flex flex-col gap-4">
      <Label>{EDGE_CLASS_VOCABULARY.corporate?.label}</Label>
      <!-- Stated rather than offered: a rename, merger or successor chain of any length is the same
           legal person continuing, so it carries no hop budget for anyone to set. -->
      <p class="text-sm">Followed all the way, however long the chain runs.</p>
      <p class="text-xs text-text-muted">{EDGE_CLASS_VOCABULARY.corporate?.meaning}</p>
    </div>
  </section>

  <section class="flex flex-col gap-12 border-t border-border-default pt-16">
    <FieldLabel as="h4">Where The Search Stops</FieldLabel>

    <div class="flex flex-col gap-4">
      <Label for="{fieldPrefix}-related-party-limit">{RELATED_PARTY_LIMIT_LABEL}</Label>
      <Input
        id="{fieldPrefix}-related-party-limit"
        type="number"
        min="0"
        inputmode="numeric"
        placeholder={firmNumber(policy?.closureCap)}
        disabled={busy}
        bind:value={draft.relatedPartyLimit}
      />
      <p class="text-xs text-text-muted">
        The most connected parties the walk may reach before it stops walking. Blank takes the
        firm's own, shown in the box.
      </p>
    </div>

    <div class="flex flex-col gap-4">
      <Label for="{fieldPrefix}-candidate-limit">{CANDIDATE_LIMIT_LABEL}</Label>
      <Input
        id="{fieldPrefix}-candidate-limit"
        type="number"
        min="0"
        inputmode="numeric"
        placeholder={firmNumber(policy?.candidateCap)}
        disabled={busy}
        bind:value={draft.candidateLimit}
      />
      <p class="text-xs text-text-muted">
        The most possible matches this check will write down. Reaching it truncates the check, and
        the check says on its own record that it was truncated.
      </p>
    </div>
  </section>
</div>
