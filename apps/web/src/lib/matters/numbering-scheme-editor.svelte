<script lang="ts">
  /*
   * The editor for one of the firm's numbering schemes: the template one of its sequences follows
   * — matter, consultation, intake, conflicts check or custody numbers, whichever purpose the page
   * hands it. It renders INSIDE a settings plate, as rows of the settings anatomy plus one table,
   * so the page it sits on reads like every other settings page rather than a form parked on one.
   * What the purpose IS — its title, its parts, what is in force — arrives on the listing record;
   * the editor keeps no second copy of the register.
   *
   * ONE LIST, ONE PREVIEW, ONE SAVE. The scheme is an ordered list of parts, and BUILDING IT IS A
   * TABLE (owner ruling, 2026-09-11): one row per part, its fields in columns, edited the way every
   * other list in the product is edited. The reordering arrows lead the row on the LEFT, because
   * they act on the row and the row begins there; Remove ends it. A column a part has no fact for
   * holds its control refused, with the reason on its hover, rather than removed — so changing a
   * part's kind never moves the columns under the hand.
   *
   * Beneath the list the server renders the list against the sample record as the reader types, so
   * the number a scheme produces is seen before it is saved rather than discovered on the first
   * record numbered under it. Save replaces the firm's scheme in one audited write.
   *
   * THE PREVIEW IS THE SERVER'S. The same renderer that draws real numbers renders the sample; this
   * component never composes a number itself, so what it shows is what a matter will get. It asks
   * only when the list passes the one rule it can check here (exactly one counter, and text that
   * can stand in a link), and it asks a moment after the last keystroke rather than on every one.
   *
   * WHAT IS IN FORCE STAYS ON SCREEN. The committed scheme is the first row of the plate, so a
   * half-edited list is never mistaken for the scheme the firm is numbering under. Discard returns
   * the list to it. A number already drawn is frozen whatever is saved here, and the line beside
   * Save says so.
   */
  import { untrack } from "svelte";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Switch from "@magna-carta/design-system/switch";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import {
    previewNumberingScheme,
    setNumberingScheme,
    type NumberingPreview,
  } from "./numbering-api.ts";
  import {
    isScoping,
    moveNumberSegment,
    newNumberSegment,
    numberingFrozenSentence,
    numberingNothingInForceSentence,
    numberingSampleSentence,
    numberingSavedSentence,
    numberingSchemeLabel,
    numberingSchemeRefusal,
    numberingSchemesEqual,
    numberingStartersFor,
    numberSegmentCellRefusal,
    numberSegmentSummary,
    numberSegmentVocabulary,
    numberSegmentVocabularyFor,
    removeNumberSegment,
    replaceNumberSegment,
    type NumberingPurposeRecord,
    type NumberingSampleContext,
    type NumberSegment,
    type NumberSegmentKind,
    type SchemeNumberingPurpose,
  } from "./numbering-scheme.ts";

  let {
    record,
    sample,
    canManage,
  }: {
    /** The purpose as the listing describes it, with what is in force at the time of the read. */
    record: NumberingPurposeRecord & { purpose: SchemeNumberingPurpose };
    /** The sample record the server rendered every example against; the preview uses the same. */
    sample: NumberingSampleContext;
    /** Whether the session may replace the scheme. Without it the scheme is read and stated. */
    canManage: boolean;
  } = $props();

  const identifier = $props.id();
  const purpose = $derived(record.purpose);
  const kinds = $derived(record.segmentKinds ?? []);
  const vocabulary = $derived(numberSegmentVocabularyFor(kinds));
  const starters = $derived(numberingStartersFor(kinds));

  // What the server said is in force, as the listing carried it when this editor was drawn. Read
  // once on purpose: the editor owns the committed scheme from here (Save moves it), and the page
  // keys each editor by its purpose, so a record is never swapped under a mounted editor.
  const initial = untrack(() => record);
  let committed = $state<readonly NumberSegment[] | null>(initial.segments);
  let usingDefault = $state(initial.usingDefault === true);
  /** The list under edit. Starts as the committed scheme and is returned to it by Discard. */
  let draft = $state<readonly NumberSegment[]>(initial.segments ?? []);
  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  let savedSentence = $state<string | null>(null);

  const refusal = $derived(numberingSchemeRefusal(draft));
  const changed = $derived(!numberingSchemesEqual(draft, committed));

  /** The server's rendering of the draft, or its refusal, or nothing while it has not answered. */
  let preview = $state<NumberingPreview | null>(null);
  let previewFailure = $state<StatedFailure | null>(null);
  /** True from the moment a preview is owed until the server answers it. */
  let previewPending = $state(false);

  // The preview follows the draft a moment behind the last edit. A list that fails the counter rule
  // is not sent: the server would refuse it, and the refusal is already on the screen.
  $effect(() => {
    const segments = draft;
    const refused = refusal;
    if (refused !== null || segments.length === 0) {
      preview = null;
      previewFailure = null;
      previewPending = false;
      return;
    }
    previewPending = true;
    const handle = setTimeout(() => {
      void (async () => {
        const outcome = await previewNumberingScheme(fetch, purpose, segments, sample);
        // A later edit may have superseded this request; only the newest answer is shown.
        if (segments !== draft) return;
        previewPending = false;
        if (outcome.kind === "ok") {
          preview = outcome.value;
          previewFailure = null;
        } else {
          // A refused preview is the renderer's own sentence — which part has no value in the
          // sample — and it travels whole rather than as a line squeezed out of it.
          preview = null;
          previewFailure = stated(
            outcome.failure,
            "The scheme could not be previewed.",
            "The preview did not answer.",
          );
        }
      })();
    }, 250);
    return () => clearTimeout(handle);
  });

  /**
   * The scheme field holds nothing at rest: choosing a shape loads it into the list and the field
   * empties again, because once a part has been changed the list is no longer that shape, and a
   * field still naming it would be claiming something the table below contradicts.
   */
  let starterChoice = $state("");

  function chooseStarter(key: string): void {
    const starter = starters.find((candidate) => candidate.key === key);
    if (starter !== undefined) draft = [...starter.segments];
    savedSentence = null;
    starterChoice = "";
  }

  function addPart(): void {
    // A first part is the counter every scheme needs; after that, the text that separates parts.
    const kind: NumberSegmentKind = draft.some((segment) => segment.kind === "counter")
      ? "literal"
      : "counter";
    draft = [...draft, newNumberSegment(kind)];
    savedSentence = null;
  }

  function changeKind(index: number, next: string): void {
    const kind = vocabulary.find((entry) => entry.kind === next)?.kind;
    if (kind === undefined || kind === draft[index]?.kind) return;
    draft = replaceNumberSegment(draft, index, newNumberSegment(kind));
    savedSentence = null;
  }

  function update(index: number, segment: NumberSegment): void {
    draft = replaceNumberSegment(draft, index, segment);
    savedSentence = null;
  }

  function setScoping(index: number, scoping: boolean): void {
    const segment = draft[index];
    if (segment === undefined || segment.kind === "literal" || segment.kind === "counter") return;
    update(index, { ...segment, scoping });
  }

  function discard(): void {
    draft = committed ?? [];
    saveFailure = null;
    savedSentence = null;
  }

  async function save(): Promise<void> {
    if (saving || refusal !== null || !changed) return;
    saving = true;
    saveFailure = null;
    savedSentence = null;
    const outcome = await setNumberingScheme(fetch, purpose, draft, crypto.randomUUID());
    saving = false;
    if (outcome.kind !== "ok") {
      saveFailure = stated(
        outcome.failure,
        "The scheme was not changed. What you wrote is still here.",
        "Nothing answered, so the scheme was not changed. What you wrote is still here.",
      );
      return;
    }
    committed = outcome.value.segments;
    usingDefault = false;
    draft = outcome.value.segments;
    savedSentence = numberingSavedSentence(record);
  }

  const KIND_CHOICES = $derived(
    vocabulary.map((entry) => ({
      value: entry.kind,
      label: entry.label,
      meaning: entry.description,
    })),
  );
  const STARTER_CHOICES = $derived(
    starters.map((starter) => ({
      value: starter.key,
      label: starter.label,
      aside: starter.example,
    })),
  );
  const YEAR_DIGIT_CHOICES = [
    { value: "4", label: "Four (2026)" },
    { value: "2", label: "Two (26)" },
  ];

  function numberOf(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  /** What one column of a part reads as a number field, where the part has one. */
  function digitsOf(segment: NumberSegment): string {
    if (segment.kind === "counter") return String(segment.padWidth);
    if (segment.kind === "year") return String(segment.digits);
    return "";
  }

  // ---- the rows of the plate, as settings definitions ----------------------------------------

  const IN_FORCE_DEFINITION = $derived<SettingDefinition>({
    id: `numbering.${purpose}.in-force`,
    sectionId: "numbering",
    label: "In Force",
    description:
      committed === null
        ? numberingNothingInForceSentence(record)
        : `What the firm is numbering under today. ${record.drawnWhen}`,
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  });

  const SCHEME_DEFINITION = $derived<SettingDefinition>({
    id: `numbering.${purpose}.scheme`,
    sectionId: "numbering",
    label: numberingSchemeLabel(record),
    description: "Choose a common shape to load into the parts below; every part is then the firm's to change.",
    kind: "select",
    defaultValue: "",
    sensitivity: "open",
  });

  const PREVIEW_DEFINITION = $derived<SettingDefinition>({
    id: `numbering.${purpose}.preview`,
    sectionId: "numbering",
    label: "Preview",
    description: numberingSampleSentence(sample, record),
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  });

  const inForceSummary = $derived(
    committed === null ? "Not set" : committed.map(numberSegmentSummary).join(" · "),
  );
</script>

{#snippet inForceRow(summary: string, badge: "not-set" | "built-in" | null)}
  <SettingsRow definition={IN_FORCE_DEFINITION}>
    {#snippet control()}
      <div class="flex flex-col items-end gap-4">
        {#if badge === "not-set"}
          <Badge variant="warning">Not set</Badge>
        {:else if badge === "built-in"}
          <Badge variant="neutral">Built-in sequence</Badge>
        {/if}
        <p class="text-end text-sm font-medium tabular-nums">{summary}</p>
      </div>
    {/snippet}
  </SettingsRow>
{/snippet}

<div class="flex flex-col divide-y divide-border-default">
  <!-- What is in force, stated before anything is edited. -->
  {@render inForceRow(inForceSummary, committed === null ? "not-set" : usingDefault ? "built-in" : null)}

  {#if canManage}
    <SettingsRow definition={SCHEME_DEFINITION}>
      {#snippet control()}
        <ChoicePicker
          options={STARTER_CHOICES}
          inputId="{identifier}-scheme"
          label={SCHEME_DEFINITION.label}
          disabled={saving}
          bind:value={() => starterChoice, chooseStarter}
        />
      {/snippet}
    </SettingsRow>

    <!-- The parts, as a table. The row above it holds the one act that adds a row. -->
    <div class="flex flex-col gap-12 py-12">
      <div class="flex items-center justify-end">
        <Button variant="secondary" size="sm" disabled={saving} onclick={addPart}>
          <Plus class="size-16" aria-hidden="true" />
          Add Part
        </Button>
      </div>
      <DataTable.Root>
        <DataTable.Caption class="sr-only">The parts of the {numberingSchemeLabel(record)}</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head class="sr-only">Order</DataTable.Head>
            <DataTable.Head>Part</DataTable.Head>
            <DataTable.Head>Text</DataTable.Head>
            <DataTable.Head>Digits</DataTable.Head>
            <DataTable.Head>Starts At</DataTable.Head>
            <DataTable.Head>Restarts The Count</DataTable.Head>
            <DataTable.Head class="sr-only">Remove</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#if draft.length === 0}
            <!-- Not a row: nothing here can be selected, so it takes none of a row's treatment. -->
            <DataTable.Row data-placeholder="true">
              <DataTable.Cell colspan={7} class="text-sm text-text-muted">
                No parts yet. Choose a scheme above, or add a part.
              </DataTable.Cell>
            </DataTable.Row>
          {/if}
          {#each draft as segment, index (index)}
            {@const vocabulary = numberSegmentVocabulary(segment.kind)}
            {@const textRefusal = numberSegmentCellRefusal(segment.kind, "text")}
            {@const digitsRefusal = numberSegmentCellRefusal(segment.kind, "digits")}
            {@const startRefusal = numberSegmentCellRefusal(segment.kind, "start")}
            {@const scopingRefusal = numberSegmentCellRefusal(segment.kind, "scoping")}
            <DataTable.Row>
              <!-- The arrows LEAD the row: they act on the row, and the row begins here. -->
              <DataTable.Cell>
                <span class="inline-flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Move up"
                    aria-label="Move part {index + 1} up"
                    disabled={saving || index === 0}
                    onclick={() => (draft = moveNumberSegment(draft, index, -1))}
                  >
                    <ArrowUp class="size-16" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Move down"
                    aria-label="Move part {index + 1} down"
                    disabled={saving || index === draft.length - 1}
                    onclick={() => (draft = moveNumberSegment(draft, index, 1))}
                  >
                    <ArrowDown class="size-16" aria-hidden="true" />
                  </Button>
                </span>
              </DataTable.Cell>
              <DataTable.Cell>
                <div class="flex flex-col gap-4">
                  <div class="w-3xs">
                    <ChoicePicker
                      options={KIND_CHOICES}
                      inputId="{identifier}-kind-{index}"
                      label="Part {index + 1}"
                      disabled={saving}
                      bind:value={() => segment.kind, (next) => changeKind(index, next)}
                    />
                  </div>
                  <span class="text-xs text-text-muted">{vocabulary.description}</span>
                </div>
              </DataTable.Cell>
              <DataTable.Cell>
                <Input
                  id="{identifier}-text-{index}"
                  class="w-3xs"
                  aria-label="Text of part {index + 1}"
                  value={segment.kind === "literal" ? segment.text : ""}
                  disabled={saving || textRefusal !== null}
                  title={textRefusal ?? undefined}
                  oninput={(event) =>
                    update(index, { kind: "literal", text: event.currentTarget.value })}
                />
              </DataTable.Cell>
              <DataTable.Cell>
                {#if segment.kind === "year"}
                  <div class="w-3xs">
                    <ChoicePicker
                      options={YEAR_DIGIT_CHOICES}
                      inputId="{identifier}-digits-{index}"
                      label="Digits"
                      disabled={saving}
                      bind:value={
                        () => String(segment.digits),
                        (next) => update(index, { ...segment, digits: next === "2" ? 2 : 4 })
                      }
                    />
                  </div>
                {:else}
                  <Input
                    id="{identifier}-digits-{index}"
                    class="w-3xs tabular-nums"
                    type="number"
                    min="1"
                    max="12"
                    aria-label="Digits of part {index + 1}"
                    value={digitsOf(segment)}
                    disabled={saving || digitsRefusal !== null}
                    title={digitsRefusal ?? undefined}
                    oninput={(event) => {
                      if (segment.kind !== "counter") return;
                      update(index, {
                        ...segment,
                        padWidth: numberOf(event.currentTarget.value, segment.padWidth),
                      });
                    }}
                  />
                {/if}
              </DataTable.Cell>
              <DataTable.Cell>
                <Input
                  id="{identifier}-start-{index}"
                  class="w-3xs tabular-nums"
                  type="number"
                  min="1"
                  aria-label="Where part {index + 1} starts"
                  value={segment.kind === "counter" ? String(segment.start ?? 1) : ""}
                  disabled={saving || startRefusal !== null}
                  title={startRefusal ?? undefined}
                  oninput={(event) => {
                    if (segment.kind !== "counter") return;
                    update(index, {
                      ...segment,
                      start: numberOf(event.currentTarget.value, segment.start ?? 1),
                    });
                  }}
                />
              </DataTable.Cell>
              <DataTable.Cell>
                <Switch
                  id="{identifier}-scoping-{index}"
                  aria-label="Part {index + 1} restarts the count"
                  bind:checked={() => isScoping(segment), (checked) => setScoping(index, checked)}
                  disabled={saving || scopingRefusal !== null}
                  title={scopingRefusal ?? undefined}
                />
              </DataTable.Cell>
              <!-- Remove ENDS the row. -->
              <DataTable.Cell class="text-end">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Remove"
                  aria-label="Remove part {index + 1}"
                  disabled={saving}
                  onclick={() => (draft = removeNumberSegment(draft, index))}
                >
                  <X class="size-16" aria-hidden="true" />
                </Button>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    </div>

    <!-- The preview: the server's own rendering of the list against the sample matter. -->
    <SettingsRow definition={PREVIEW_DEFINITION}>
      {#snippet control()}
        {#if refusal !== null}
          <p class="text-end text-sm text-status-danger-subtle-foreground">{refusal}</p>
        {:else if previewFailure !== null}
          <FailureNotice
            failure={previewFailure.failure}
            title="The Scheme Could Not Be Previewed"
            fallback={previewFailure.fallback}
            whenSilent={previewFailure.whenSilent}
          />
        {:else}
          <LoadingRegion
            loading={preview === null}
            refreshing={previewPending}
            label="Rendering the preview"
            class="flex flex-col items-end gap-4"
          >
            {#snippet fixture()}
              <p class="text-lg tabular-nums">2026-0001</p>
              <p class="text-end text-xs text-text-muted">One count across the whole firm.</p>
            {/snippet}
            {#if preview !== null}
              <p class="text-lg tabular-nums">{preview.number}</p>
              <p class="text-end text-xs text-text-muted">
                {preview.scopeKey === ""
                  ? "One count across the whole firm."
                  : `The count restarts for each ${preview.scopeKey.split(":").length === 1 ? "value" : "combination"} of the parts that restart it; this sample counts under "${preview.scopeKey}".`}
              </p>
            {/if}
          </LoadingRegion>
        {/if}
      {/snippet}
    </SettingsRow>

    {#if saveFailure !== null}
      <FailureNotice
        failure={saveFailure.failure}
        title="The Scheme Was Not Changed"
        fallback={saveFailure.fallback}
        whenSilent={saveFailure.whenSilent}
        onRetry={() => void save()}
      />
    {/if}
    {#if savedSentence !== null}
      <SettingsPlateNote>{savedSentence}</SettingsPlateNote>
    {/if}

    <!-- The plate's exit: the consequence beside the act, and the act itself. -->
    <div class="flex flex-wrap items-center justify-between gap-12 py-12">
      <p class="text-sm text-text-muted">{numberingFrozenSentence(record)}</p>
      <div class="flex gap-8">
        <Button variant="secondary" size="sm" disabled={saving || !changed} onclick={discard}>
          Discard
        </Button>
        <Button
          variant={changed && refusal === null ? "primary" : "secondary"}
          size="sm"
          disabled={saving || !changed || refusal !== null}
          onclick={() => void save()}
        >
          {saving ? "Saving" : "Save Scheme"}
        </Button>
      </div>
    </div>
  {/if}
</div>
