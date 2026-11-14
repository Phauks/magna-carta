<script lang="ts">
  /*
   * Settings · Conflicts — the firm's floor: what every check must search, whatever the person
   * running it asks for.
   *
   * THIS PAGE CHANGES WHAT FUTURE CHECKS FIND, AND IT RE-RUNS NOTHING. Raising the floor does not
   * touch a single check already on the record — it makes a SHORTFALL appear on every matter whose
   * last check no longer covers what the firm now requires, computed live on each matter's own
   * posture read rather than swept onto rows. So the effect is immediate and total, and yet nothing
   * here writes to the log. Lowering the floor is the direction worth pausing over: it reduces what
   * the firm will look at from here on, and no check row ever records that a person chose that,
   * which is why the write is audited and sits behind its own permission.
   *
   * DRAFT, NOT INSTANT. Every control stages until Save. A settings page that applied on each
   * click would make a floor of whatever a half-finished edit happened to say, for as long as it
   * took to finish it.
   *
   * WHAT IS SAVED IS WHAT IS SHOWN BACK. The platform normalizes a policy on the way in: the party
   * class is unioned back into the floor, `current` back into the name roles. The screen renders
   * the RESPONSE rather than its own request, so an administrator is never shown a floor their
   * checks would not run — and where the two differ, they see the difference immediately instead
   * of discovering it on a check.
   *
   * NOTHING HERE LIMITS A CHECK. The page once carried a hop budget per kind of relationship, a
   * default depth and two caps, and the owner removed them on 2026-09-11: a check follows every
   * recorded relationship to closure, and the one bound on a run is the platform's, stated on the
   * record when it is reached. A firm decides what a check must search and how names are compared,
   * never how far it may look.
   *
   * TWO CONTROLS ARE DELIBERATELY LOCKED. Party and Current are shown, checked, and disabled with
   * the reason on them, rather than omitted. A firm-wide invariant a reader cannot see reads as an
   * option somebody forgot to offer.
   *
   * THE SCROLL IS THE SHARED ONE. Masthead, then SettingsScrollRegion, then the page's content —
   * the same three-story anatomy every settings page keeps, so the settings surface has ONE scroll
   * area and one set of edges. This page had a copy of the region's two divs written out by hand,
   * which is how the outer spacing of one settings page comes to disagree with the rest.
   *
   * ITS EXIT IS STILL ITS OWN. Save and Discard sit at the foot of the content rather than in the
   * pinned SettingsCommitFooter, because that footer commits a SettingsDraft of named definitions
   * and this page stages a whole policy document. Moving it there is a rewrite of what the page
   * stages, not a change of frame.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Separator from "@magna-carta/design-system/separator";
  import { SAMPLE_SENTENCE } from "@magna-carta/design-system/loading-fixtures";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import {
    readFirmConflictsPolicy,
    writeFirmConflictsPolicy,
    CONFIGURE_CONFLICTS_PERMISSION,
    type FirmConflictsPolicy,
    type SourceClass,
    type Strictness,
  } from "$lib/conflicts/conflicts-api.ts";
  import {
    NAME_ROLES,
    SOURCE_CLASSES,
    SOURCE_VOCABULARY,
    STRICTNESS_LEVELS,
    STRICTNESS_VOCABULARY,
    nameRoleVocabulary,
  } from "$lib/conflicts/conflicts-vocabulary.ts";
  import { newWriteKey } from "$lib/matters/tasks-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  /*
   * The two the firm cannot switch off. Rendered as locked controls rather than hidden ones — see
   * the header note. `party` is the firm-wide corpus (conflicts impute across the whole firm, so it
   * is not an option), and `current` is the name a party goes by today.
   */
  const LOCKED_SOURCE: SourceClass = "party";
  const LOCKED_NAME_ROLE = "current";

  /** The class with no corpus behind it: a firm cannot put it in the floor because it cannot run. */
  const UNAVAILABLE_SOURCE: SourceClass = "content";

  let committed = $state<FirmConflictsPolicy | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  let session = $state<SessionBootstrap | null>(null);
  let saving = $state(false);
  let savedAt = $state<string | null>(null);

  // The staged edit. Null until the committed policy lands, so the form never renders over guesses.
  let draft = $state<FirmConflictsPolicy | null>(null);

  const permissions = $derived(session?.permissions ?? null);
  const mayConfigure = $derived(
    permissions === null || permissions.includes(CONFIGURE_CONFLICTS_PERMISSION),
  );
  const REFUSAL = permissionRefusal("Setting the firm's conflicts minimum", CONFIGURE_CONFLICTS_PERMISSION);

  function readPolicy(): void {
    committed = null;
    readFailure = null;
    void (async () => {
      const outcome = await readFirmConflictsPolicy(fetch);
      if (outcome.kind !== "ok") {
        readFailure = stated(outcome.failure, "Couldn't load the firm's conflicts minimum.");
        return;
      }
      committed = outcome.value;
      draft = structuredClone(outcome.value);
    })();
  }

  $effect(() => {
    readPolicy();
  });

  $effect(() => {
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  /*
   * Whether anything is staged. Compared on the SERIALIZED value rather than field by field, because
   * a comparison written out by hand grows a blind spot the first time a field is added — and a
   * settings page whose Save is dark while an edit is staged loses the edit.
   */
  const dirty = $derived(
    committed !== null && draft !== null && JSON.stringify(committed) !== JSON.stringify(draft),
  );

  function toggleSource(source: SourceClass, on: boolean): void {
    if (draft === null) return;
    repairs = [];
    const next = new Set(draft.floorSources);
    if (on) next.add(source);
    else next.delete(source);
    // Ordered by the catalogue so the staged value and a re-read value compare equal after a save
    // that changed nothing but the order somebody clicked them in.
    draft = { ...draft, floorSources: SOURCE_CLASSES.filter((each) => next.has(each)) };
  }

  function toggleNameRole(role: string, on: boolean): void {
    if (draft === null) return;
    repairs = [];
    const next = new Set(draft.balancedNameRoles);
    if (on) next.add(role);
    else next.delete(role);
    // Sorted, because that is how the platform canonicalizes and therefore stores them. Ordering
    // them by the catalogue instead would leave the form looking dirty after a role was switched
    // off and back on, with the set unchanged — the display order is the `{#each NAME_ROLES}` below
    // and does not depend on this.
    draft = { ...draft, balancedNameRoles: NAME_ROLES.filter((each) => next.has(each)).toSorted() };
  }

  function discard(): void {
    if (committed === null) return;
    draft = structuredClone(committed);
    writeFailure = null;
  }

  async function save(): Promise<void> {
    if (draft === null || saving || !dirty) return;
    saving = true;
    writeFailure = null;
    // Held so the response can be compared against exactly what was asked for; `draft` is replaced
    // by the stored value below, and comparing that against itself would report no repair ever.
    const sent = structuredClone(draft);
    const outcome = await writeFirmConflictsPolicy(fetch, sent, newWriteKey());
    saving = false;
    if (outcome.kind !== "ok") {
      writeFailure = stated(outcome.failure, "The firm's conflicts minimum wasn't changed.");
      return;
    }
    // The RESPONSE, not the request: what came back is what the checks will run. Where the platform
    // repaired something the administrator asked for, this is where they see it.
    repairs = describeRepairs(sent, outcome.value);
    committed = outcome.value;
    draft = structuredClone(outcome.value);
    savedAt = new Date().toISOString();
  }

  /*
   * What the platform changed on the way in, if anything — computed by comparing the request that
   * was just sent against the policy that came back. It names the specific repair rather than
   * describing the possibility in the abstract, because the failure this guards against is an
   * administrator not noticing that a control moved on its own after they pressed Save.
   */
  function describeRepairs(sent: FirmConflictsPolicy, stored: FirmConflictsPolicy): string[] {
    const notes: string[] = [];

    const addedSources = stored.floorSources.filter((source) => !sent.floorSources.includes(source));
    for (const source of addedSources) {
      notes.push(
        `${SOURCE_VOCABULARY[source]?.label ?? source} is back in the minimum: every check searches it.`,
      );
    }

    const addedRoles = stored.balancedNameRoles.filter(
      (role) => !sent.balancedNameRoles.includes(role),
    );
    for (const role of addedRoles) {
      notes.push(
        `${nameRoleVocabulary(role).label} is back in the names compared: every check compares it.`,
      );
    }

    return notes;
  }

  let repairs = $state<readonly string[]>([]);
</script>

<svelte:head>
  <title>Conflicts · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="conflicts"
  title="Conflicts"
  posture={mayConfigure ? "draft" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
    <SettingsDescription>
      What every conflicts check must search, whatever the person running it chooses.
    </SettingsDescription>

    <Alert.Root variant="info">
      <Alert.Title>Every Check Searches at Least This Much</Alert.Title>
      <Alert.Description>
        Someone running a check can search wider than this. A narrower request is raised to this minimum, and the check records that. Changing it doesn't re-run or change past checks; a matter whose last check falls short shows that on its Conflicts tab.
      </Alert.Description>
    </Alert.Root>

    {#if session !== null && !mayConfigure}
      <Alert.Root variant="info">
        <Alert.Title>This Account Can't Change the Minimum</Alert.Title>
        <Alert.Description>{REFUSAL} Anyone who can view a check can view this minimum.</Alert.Description>
      </Alert.Root>
    {/if}

    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure.failure}
        title="Nothing Changed"
        fallback={writeFailure.fallback}
        onRetry={() => void save()}
      />
    {/if}

    {#if repairs.length > 0}
      <Alert.Root variant="warning">
        <Alert.Title>Saved, With Changes</Alert.Title>
        <Alert.Description>
          What is shown below is what the firm's checks will run.
          <ul class="mt-8 flex list-disc flex-col gap-2 ps-16">
            {#each repairs as repair (repair)}
              <li>{repair}</li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}

    <LoadingRegion
      loading={committed === null}
      failed={readFailure !== null}
      label="Reading the firm's conflicts minimum"
      onRetry={readPolicy}
      class="flex flex-col gap-24"
    >
      {#snippet failure()}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure.failure}
            subject="The firm's conflicts minimum"
            fallback={readFailure.fallback}
            onRetry={readPolicy}
          />
        {/if}
      {/snippet}

      {#snippet fixture()}
        <!-- The form's own shape, in its own components, over nothing a reader could mistake for a
             floor: the controls stand where they will stand and carry no value. The region holds it
             inert and hidden from assistive technology, so no checkbox here can be read as a source
             this firm searches. Without a fixture the children would render nothing while the read
             is in flight, because they are guarded on the policy having arrived. -->
        {#each ["What Every Check Must Search", "The Band Every Check Must Reach"] as heading (heading)}
          <section class="flex flex-col gap-16">
            <FieldLabel as="h2">{heading}</FieldLabel>
            <div class="flex flex-col gap-8">
              {#each [0, 1, 2] as row (row)}
                <div class="flex items-start gap-8">
                  <Checkbox checked={false} disabled />
                  <div class="flex flex-col gap-2">
                    <Label>{SAMPLE_SENTENCE.slice(0, 18)}</Label>
                    <p class="text-xs text-text-muted">{SAMPLE_SENTENCE}</p>
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/each}
      {/snippet}

      {#if draft !== null}
        <section class="flex flex-col gap-16">
          <FieldLabel as="h2">What Every Check Must Search</FieldLabel>
          <div class="flex flex-col gap-8">
            {#each SOURCE_CLASSES as source (source)}
              {@const word = SOURCE_VOCABULARY[source]}
              {@const locked = source === LOCKED_SOURCE}
              {@const unavailable = source === UNAVAILABLE_SOURCE}
              <div class="flex items-start gap-8">
                <Checkbox
                  id="conflicts-floor-{source}"
                  checked={locked || draft.floorSources.includes(source)}
                  disabled={locked || unavailable || !mayConfigure || saving}
                  title={locked
                    ? "Conflicts apply across the whole firm, so parties are always searched."
                    : unavailable
                      ? "Document text isn't searchable yet, so checks list it as not searched."
                      : undefined}
                  onCheckedChange={(on) => toggleSource(source, on === true)}
                />
                <div class="flex flex-col gap-2">
                  <Label for="conflicts-floor-{source}">{word?.label ?? source}</Label>
                  {#if word?.meaning}
                    <p class="text-xs text-text-muted">{word.meaning}</p>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>

        <Separator />

        <section class="flex flex-col gap-16">
          <FieldLabel as="h2">The Name Matching Every Check Must Reach</FieldLabel>
          <!-- Stated because it is the invariant that makes the choice safe: the wider band searches
               every name role and every phonetic scheme, so raising this can only add candidates. -->
          <p class="text-sm text-text-muted">
            The wider band includes everything the narrower one finds, so raising it can only add results.
          </p>
          <RadioGroup.Root
            value={draft.floorStrictness}
            disabled={!mayConfigure || saving}
            onValueChange={(value) => {
              if (draft !== null) draft = { ...draft, floorStrictness: value as Strictness };
            }}
            aria-labelledby="conflicts-strictness-label"
          >
            {#each STRICTNESS_LEVELS as level (level)}
              {@const word = STRICTNESS_VOCABULARY[level]}
              <div class="flex items-start gap-8">
                <RadioGroup.Item value={level} id="conflicts-strictness-{level}" />
                <div class="flex flex-col gap-2">
                  <Label for="conflicts-strictness-{level}">{word.label}</Label>
                  <p class="text-xs text-text-muted">{word.meaning}</p>
                </div>
              </div>
            {/each}
          </RadioGroup.Root>
        </section>

        <Separator />

        <section class="flex flex-col gap-16">
          <FieldLabel as="h2">Which Names Standard Matching Compares</FieldLabel>
          <!-- The wider band is not configurable here, and saying so is what keeps the superset
               claim above legible: whatever is chosen, it is a subset of "every role". -->
          <p class="text-sm text-text-muted">
            These apply to the narrower band only. The wider band always compares every name a party has.
          </p>
          <div class="flex flex-col gap-8">
            {#each NAME_ROLES as role (role)}
              {@const word = nameRoleVocabulary(role)}
              {@const locked = role === LOCKED_NAME_ROLE}
              <div class="flex items-start gap-8">
                <Checkbox
                  id="conflicts-name-role-{role}"
                  checked={locked || draft.balancedNameRoles.includes(role)}
                  disabled={locked || !mayConfigure || saving}
                  title={locked
                    ? "A check must always compare the party's current name."
                    : undefined}
                  onCheckedChange={(on) => toggleNameRole(role, on === true)}
                />
                <div class="flex flex-col gap-2">
                  <Label for="conflicts-name-role-{role}">{word.label}</Label>
                  {#if word.meaning}
                    <p class="text-xs text-text-muted">{word.meaning}</p>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>

        <Separator />


        <div class="flex flex-wrap items-center gap-8">
          <Button
            disabled={!mayConfigure || !dirty || saving}
            title={mayConfigure ? undefined : REFUSAL}
            onclick={() => void save()}
          >
            {saving ? "Saving" : "Save Minimum"}
          </Button>
          <Button variant="ghost" disabled={!dirty || saving} onclick={discard}>Discard</Button>
          {#if dirty}
            <span class="text-sm text-text-muted">Not saved yet. Nothing has changed for any check.</span>
          {:else if savedAt !== null}
            <span class="text-sm text-text-muted">Saved. Checks from now on use this minimum.</span>
          {/if}
        </div>
      {/if}
    </LoadingRegion>
</SettingsScrollRegion>
