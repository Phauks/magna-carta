<script lang="ts">
  /*
   * Settings · AI and the Assistant — the screen a firm opens its two consent gates from, under
   * Data & Platform. Until this page existed the gates were reachable only through the settings
   * write path, so every firm's assistant rendered its closed state and no administrator could
   * open it.
   *
   * TWO PLATES, BECAUSE THEY ARE TWO QUESTIONS. The first asks whether this firm's content may be
   * sent to a third-party model at all; the second asks whether the assistant is one of the things
   * that may send it, and how much of it a day. Neither implies the other, and the server reads
   * both — apps/api-worker/src/magnus/consent.ts is the one reader, and it fails closed on either.
   *
   * THE MODEL IS STATED BESIDE THE GATE IT ANSWERS FOR. Consenting to third-party processing
   * without being told which model receives the content, what it retains, and whether it trains on
   * it, is consent to nothing legible — so the first plate closes with the four reported facts. They
   * are facts, not settings: they render as definition-list rows in the Versions page's voice, never
   * as dead controls, and no control here writes a model (ai-settings-api.ts says why selecting one
   * is a different question).
   *
   * Server-backed on the Reports page's pattern: the draft reads and writes
   * GET/PATCH /api/v1/firm/ai/settings and stages nothing into local storage; the edit right is
   * `firm:manageAiSettings`, read from the session. A member without it sees the firm's answer
   * engraved as a fact — which is the point of leaving both switches at sensitivity "open": whether
   * the firm's content goes to a model is something every member of the firm may know, even where
   * only an administrator may decide it. History is withheld: the record of a change is the audit
   * row the server writes, and for this page in particular that row is the record of who consented.
   */
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import {
    AI_PROCESSING_ELIGIBILITY_DEFINITION,
    AI_SETTINGS_SECTION_ID,
    AiSettingsDraft,
    MAGNUS_DAILY_TURN_CEILING_DEFINITION,
    MAGNUS_ENABLED_DEFINITION,
  } from "$lib/ai/ai-settings-draft.svelte.ts";
  import { MANAGE_AI_SETTINGS_PERMISSION } from "$lib/ai/ai-settings-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const draft = new AiSettingsDraft(fetch);

  let session = $state<SessionBootstrap | null>(null);
  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(session?.permissions.includes(MANAGE_AI_SETTINGS_PERMISSION) ?? false);

  const model = $derived(draft.committed?.model ?? null);

  $effect(() => {
    void draft.load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>AI and the Assistant · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId={AI_SETTINGS_SECTION_ID}
  title="AI and the Assistant"
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
  showHistory={false}
/>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsDescription>
      Whether this firm's content may be sent to a model, and which of the platform's features may
      send it. Everything here is off until the firm turns it on.
    </SettingsDescription>

    {#if draft.saveFailure !== null}
      <FailureNotice
        failure={draft.saveFailure}
        title="The Change Was Not Saved"
        fallback="Nothing changed. What you chose is still staged."
        whenSilent="Nothing answered, so nothing changed. What you chose is still staged."
        onRetry={() => void draft.commit()}
      />
    {/if}

    <!-- One reported fact about the model, in the Versions page's definition-list voice: the shared
         table grid (marker gutter, flexible label, value at the control-column measure), so these
         rows keep the same vertical edge as the switches above them without pretending to be
         controls. `detail` carries the one-line reading of a value that needs one. -->
    {#snippet modelFact(label: string, value: string, detail: string | null)}
      <div class="flex items-baseline gap-16 py-12">
        <div class="shrink-0" style="inline-size: var(--mc-space-16)"></div>
        <FieldLabel as="dt" class="min-w-0 grow">{label}</FieldLabel>
        <dd
          class="flex shrink-0 flex-col items-end gap-4 text-end"
          style="inline-size: var(--mc-size-popover)"
        >
          <span class="text-sm font-medium text-text-default tabular-nums">{value}</span>
          {#if detail !== null}
            <span class="text-xs text-text-muted">{detail}</span>
          {/if}
        </dd>
      </div>
    {/snippet}

    <!--
      ONE READ, ONE FAILURE NOTICE. All three plates below are drawn from the single
      GET /api/v1/firm/ai/settings, so a failed read is one fact about the page and not three: it
      replaces the plates rather than repeating itself inside each of them. The plates' own
      LoadingRegions therefore carry the LOADING state only — a `failed` region with no `failure`
      snippet falls through to its sample fixture, which would show invented switch positions for a
      read that did not happen, and on this page of all pages an invented "off" is a lie about
      consent.
    -->
    {#if draft.readFailure !== null && !draft.loaded}
      <FailureNotice
        failure={draft.readFailure}
        title="The AI Settings Could Not Be Read"
        fallback="The firm's AI settings were not read, so this page cannot say where the firm stands."
        whenSilent="Nothing answered, so this page cannot say where the firm stands."
        onRetry={() => void draft.load()}
      />
    {:else}
    <SettingsPlate heading="Third-Party AI Processing">
      <LoadingRegion
        loading={!draft.loaded}
        label="Reading the firm's AI settings"
      >
        {#snippet fixture()}
          <SettingsRow
            definition={AI_PROCESSING_ELIGIBILITY_DEFINITION}
            value={AI_PROCESSING_ELIGIBILITY_DEFINITION.defaultValue}
          />
        {/snippet}
        {#if canEdit}
          <SettingsRow definition={AI_PROCESSING_ELIGIBILITY_DEFINITION} {draft} />
        {:else}
          <SettingsRow
            definition={AI_PROCESSING_ELIGIBILITY_DEFINITION}
            value={draft.value(AI_PROCESSING_ELIGIBILITY_DEFINITION)}
          />
        {/if}
      </LoadingRegion>
    </SettingsPlate>

    <!-- The model plate is deliberately a SEPARATE plate rather than more rows in the one above:
         its rows are reported facts and the ones above are decisions, and a ledger that mixes the
         two invites reading a fact as something that can be changed. When the platform carries no
         entry for the firm's stored model, the plate states that rather than naming a model — see
         the route's comment on why the field is nullable. -->
    <SettingsPlate heading="The Model Your Content Reaches">
      <LoadingRegion loading={!draft.loaded} label="Reading the model in force">
        {#snippet fixture()}
          <dl class="flex flex-col">
            {@render modelFact("Model", "anthropic/model-name", null)}
            {@render modelFact("Snapshot", "model-name", "the exact release behind an answer")}
          </dl>
        {/snippet}
        <dl class="flex flex-col divide-y divide-border-default">
          {#if model === null}
            {@render modelFact(
              "Model",
              "—",
              "The platform no longer carries the model this firm last selected.",
            )}
          {:else}
            {@render modelFact("Model", model.modelId, null)}
            {@render modelFact("Snapshot", model.snapshotId, "the exact release behind an answer")}
            {@render modelFact(
              "Zero Data Retention",
              model.zeroDataRetention ? "In force" : "Not in force",
              model.zeroDataRetention
                ? "The provider keeps nothing that is sent to it."
                : "The provider retains what is sent to it.",
            )}
            {@render modelFact(
              "Training on Your Content",
              model.noTraining ? "Never" : "Permitted",
              model.noTraining ? "The provider does not train on what it receives." : null,
            )}
          {/if}
        </dl>
      </LoadingRegion>
    </SettingsPlate>

    <SettingsPlate heading="Magnus, the Assistant">
      <LoadingRegion loading={!draft.loaded} label="Reading the assistant's settings">
        {#snippet fixture()}
          <SettingsRow
            definition={MAGNUS_ENABLED_DEFINITION}
            value={MAGNUS_ENABLED_DEFINITION.defaultValue}
          />
          <SettingsRow
            definition={MAGNUS_DAILY_TURN_CEILING_DEFINITION}
            value={MAGNUS_DAILY_TURN_CEILING_DEFINITION.defaultValue}
          />
        {/snippet}
        {#each [MAGNUS_ENABLED_DEFINITION, MAGNUS_DAILY_TURN_CEILING_DEFINITION] as definition (definition.id)}
          {#if canEdit}
            <SettingsRow {definition} {draft} />
          {:else}
            <SettingsRow {definition} value={draft.value(definition)} />
          {/if}
        {/each}
      </LoadingRegion>
    </SettingsPlate>

    <!--
      THE EFFECTIVE ANSWER, STATED. The two switches compose, and an assistant switched on above a
      closed processing gate does nothing at all — a member who reads only "Magnus: On" has been
      told it works. So the page says what the server will actually do, over the STAGED values, so
      the sentence tracks what is about to be saved rather than what was saved last. The assistant's
      own surface says the same thing to the member who reaches it and finds it shut; this is that
      sentence for the person who can do something about it.
    -->
    {#if draft.loaded}
      <p class="text-sm text-text-muted">
        {#if draft.magnusReachesAModel}
          Members with permission can ask the assistant questions, and what they type is sent to the
          model above.
        {:else if draft.stagedValue(AI_PROCESSING_ELIGIBILITY_DEFINITION) !== true}
          Nothing is sent to any model. Third-party AI processing is off, so the assistant is off
          with it — turning Magnus on alone changes nothing.
        {:else}
          Nothing is sent to any model on the assistant's behalf. Magnus is off; other AI features
          are unaffected.
        {/if}
      </p>
    {/if}
    {/if}
  </div>
</div>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
