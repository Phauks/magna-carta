<script lang="ts">
  /*
   * Settings · AI — the screen a firm opens its two consent gates from, under
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
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import type { ChoiceOption } from "$lib/components/choice-picker.ts";
  import {
    AI_PROCESSING_ELIGIBILITY_DEFINITION,
    AI_SETTINGS_SECTION_ID,
    AiSettingsDraft,
    MAGNUS_DAILY_TURN_CEILING_DEFINITION,
    MAGNUS_ENABLED_DEFINITION,
    PLATFORM_MODEL_CHOICE,
  } from "$lib/ai/ai-settings-draft.svelte.ts";
  import {
    MANAGE_AI_SETTINGS_PERMISSION,
    type AiReasoningEffort,
  } from "$lib/ai/ai-settings-api.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  const draft = new AiSettingsDraft(fetch);

  let session = $state<SessionBootstrap | null>(null);
  // Read-only until the session says otherwise: a control that appears and then vanishes when the
  // permission turns out to be missing reads as a broken page.
  const canEdit = $derived(session?.permissions.includes(MANAGE_AI_SETTINGS_PERMISSION) ?? false);

  // The provider's effort names, as a reader says them.
  const EFFORT_LABELS: Readonly<Record<AiReasoningEffort, string>> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum",
  };
  const effortLabel = (effort: AiReasoningEffort): string => EFFORT_LABELS[effort];

  // The facts beneath the control describe the STAGED choice, so they read back what saving will do.
  const shownModel = $derived(draft.stagedModelChoice);

  // The roster as the combobox offers it: the platform's own choice first, then each verified model
  // by the provider's name, with its tier, the date its retention facts were last checked, and — when
  // the provider's live list was read and omits it — that it is no longer listed.
  const modelOptions = $derived.by((): readonly ChoiceOption[] => {
    const definition = draft.modelDefinition;
    const roster = draft.committed?.models ?? [];
    return (definition.options ?? []).map((option) => {
      const entry = roster.find((choice) => choice.modelId === option.value);
      return entry === undefined
        ? { value: option.value, label: option.label, keywords: ["platform", "current"] }
        : {
            value: option.value,
            label: option.label,
            aside: [
              entry.tier,
              `zero data retention, verified ${entry.verifiedOn}`,
              entry.published === false ? "not in the provider's current list" : null,
            ]
              .filter((part) => part !== null)
              .join(" · "),
            keywords: [entry.tier ?? "", entry.snapshotId, entry.modelId],
          };
    });
  });

  // What the provider's live list said, as one sentence: the roster above is the whole choice in
  // every case, so this only ever adds what the platform could see and when.
  const providerSummary = $derived.by((): { value: string; detail: string } | null => {
    const provider = draft.committed?.provider;
    if (provider === undefined) return null;
    if (provider.status === "not-configured") {
      return {
        value: "Not checked",
        detail:
          "The platform is not set up to read the provider's live model list, so the roster above is the verified catalog alone.",
      };
    }
    if (provider.status === "unreachable") {
      return {
        value: "Unavailable",
        detail: `The provider's model list could not be read${provider.checkedAt === null ? "" : ` at ${formatInstant(provider.checkedAt)}`}; the roster above is unaffected.`,
      };
    }
    const waiting = provider.awaitingVerification.map((model) => model.displayName);
    return {
      value: provider.checkedAt === null ? "Checked" : `Checked ${formatInstant(provider.checkedAt)}`,
      detail:
        waiting.length === 0
          ? "Every model the provider lists that the platform could offer is on the roster."
          : `Published but not on the roster yet: ${waiting.join(", ")}. A model is added only once its retention terms are verified; one that requires the provider to keep your content is never offered.`,
    };
  });

  $effect(() => {
    void draft.load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });
</script>

<svelte:head>
  <title>AI · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId={AI_SETTINGS_SECTION_ID}
  title="AI"
  posture={canEdit ? "draft" : "readOnly"}
  draft={canEdit ? draft : undefined}
  showHistory={false}
/>

<!-- One reported fact about the model, in the Versions page's definition-list voice: the shared
     table grid (marker gutter, flexible label, value at the control-column measure), so these rows
     keep the same vertical edge as the switches above them without pretending to be controls.
     `detail` carries the one-line reading of a value that needs one. Declared at the top level: a
     snippet declared inside a component's children would become that component's prop. -->
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

<SettingsScrollRegion>
    <SettingsDescription>
      Whether this firm's content may be sent to a model, and which of the platform's features may
      send it. Everything here is off until the firm turns it on.
    </SettingsDescription>

    {#if draft.saveFailure !== null}
      <FailureNotice
        failure={draft.saveFailure}
        title="The Change Was Not Saved"
        fallback="Nothing changed. What you chose is still staged."
        whenSilent="Couldn't connect. Nothing changed, and your choices are still here."
        onRetry={() => void draft.commit()}
      />
    {/if}

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
        whenSilent="Couldn't connect, so the firm's status can't be shown."
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

    <!-- The model plate holds ONE decision and the facts about it. The decision is the choice: the
         platform's current model, which moves forward as better ones are verified, or one roster
         entry the firm pins itself to. The rows beneath are facts about whatever the control holds
         RIGHT NOW — the staged choice, not the saved one — so the reader sees what they are about
         to choose before they save it. The roster is the platform's verified catalog: nothing
         lists models at runtime that could also carry the retention facts, so the catalog's own
         version and effective date are stated as the honest answer to how fresh the list is. When
         the platform carries no entry for the firm's stored model, the plate states that rather
         than naming a model — see the route's comment on why the field is nullable. -->
    <SettingsPlate heading="The Model Your Content Reaches">
      <LoadingRegion loading={!draft.loaded} label="Reading the model in force">
        {#snippet fixture()}
          <SettingsRow definition={draft.modelDefinition} value={PLATFORM_MODEL_CHOICE} />
          <dl class="flex flex-col">
            {@render modelFact("Snapshot", "model-name", "the exact release behind an answer")}
          </dl>
        {/snippet}
        {#if canEdit}
          <SettingsRow definition={draft.modelDefinition} {draft}>
            {#snippet control()}
              <!-- The product's one closed choice, a combobox: each roster row carries the fact a
                   choice is made on, its verification date, beside its id. -->
              <div class="w-full">
                <ChoicePicker
                  inputId="settings-{draft.modelDefinition.id}"
                  label="Model"
                  options={modelOptions}
                  value={String(draft.stagedValue(draft.modelDefinition))}
                  onchange={(next) => draft.stage(draft.modelDefinition, next)}
                />
              </div>
            {/snippet}
          </SettingsRow>
        {:else}
          <SettingsRow
            definition={draft.modelDefinition}
            value={draft.value(draft.modelDefinition)}
          />
        {/if}
        <dl class="flex flex-col divide-y divide-border-default">
          {#if shownModel === null}
            {@render modelFact(
              "Model",
              "—",
              "The platform no longer carries the model this firm last selected.",
            )}
          {:else}
            {@render modelFact("Model", shownModel.displayName, shownModel.modelId)}
            {@render modelFact(
              "Snapshot",
              shownModel.snapshotId,
              "the exact release behind an answer",
            )}
            {@render modelFact(
              "Zero Data Retention",
              shownModel.zeroDataRetention ? "In force" : "Not in force",
              shownModel.zeroDataRetention
                ? `The provider keeps nothing that is sent to it. Verified ${shownModel.verifiedOn}.`
                : "The provider retains what is sent to it.",
            )}
            {@render modelFact(
              "Training on Your Content",
              shownModel.noTraining ? "Never" : "Permitted",
              shownModel.noTraining ? "The provider does not train on what it receives." : null,
            )}
            {@render modelFact(
              "Still Published",
              `Confirmed ${shownModel.availabilityVerifiedOn}`,
              shownModel.retirementNotBefore === null
                ? null
                : `The provider names ${shownModel.retirementNotBefore} as the earliest it may retire this model.`,
            )}
            {#if shownModel.effortLevels.length > 0}
              {@render modelFact(
                "Effort Levels",
                shownModel.effortLevels.map(effortLabel).join(", "),
                shownModel.defaultEffort === null
                  ? "How much thinking a request may spend; each feature chooses per request."
                  : `How much thinking a request may spend; each feature chooses per request, and ${effortLabel(shownModel.defaultEffort).toLowerCase()} applies when it names none.`,
              )}
            {/if}
          {/if}
          {#if draft.committed !== null && draft.committed.catalog.version > 0}
            {@render modelFact(
              "Roster",
              `Catalog version ${String(draft.committed.catalog.version)}, effective ${draft.committed.catalog.effectiveDate}`,
              "The platform's verification pass is what keeps it current; a model joins the roster only once its retention facts have been checked.",
            )}
          {/if}
          {#if providerSummary !== null}
            {@render modelFact(
              "Provider's Live List",
              providerSummary.value,
              providerSummary.detail,
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
      THE EFFECTIVE ANSWER, STATED — AND ONLY AS FAR AS THIS PAGE CAN SEE. The two switches compose,
      and an assistant switched on above a closed processing gate does nothing at all, so a member
      who reads only "Magnus: On" has been told it works. The sentence reads the STAGED values, so it
      tracks what is about to be saved rather than what was saved last.
      What it deliberately does NOT claim is that anything reaches a provider. There is a THIRD gate
      this page cannot see: the deployment's own `MAGNUS_INFERENCE_ADAPTER`
      (apps/api-worker/src/magnus/inference-port-binding.ts), absent by default, which resolves to a
      stub reaching no provider — so "both switches open" means the FIRM has consented, not that
      content is in flight. Claiming the latter would be false in every deployment where that
      variable is unset, and on this page of all pages a confident overstatement about where client
      content goes is the worst available error. Reporting the third gate here needs the route to
      expose it, which is a deliberate open question, not an oversight.
    -->
    {#if draft.loaded}
      <p class="text-sm text-text-muted">
        {#if draft.magnusReachesAModel}
          Your firm has consented: members with permission can ask the assistant questions, and what
          they type may be sent to the model above.
        {:else if draft.stagedValue(AI_PROCESSING_ELIGIBILITY_DEFINITION) !== true}
          Nothing is sent to any AI model. Third-party AI processing is off, so the assistant is off too.
        {:else}
          Nothing is sent to any model on the assistant's behalf. Magnus is off; other AI features
          are unaffected.
        {/if}
      </p>
    {/if}
    {/if}
</SettingsScrollRegion>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}
