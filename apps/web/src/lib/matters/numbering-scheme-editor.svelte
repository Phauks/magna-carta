<script lang="ts">
  /*
   * The editor for one of the firm's numbering schemes: the template one of its sequences follows,
   * whichever purpose the page hands it. It renders INSIDE a settings plate, as rows of the
   * settings anatomy plus one table, so the page it sits on reads like every other settings page
   * rather than a form parked on one. What the purpose IS — its title, its parts, what is in force,
   * what decides its count's scope — arrives on the listing record; the editor keeps no second copy
   * of the register.
   *
   * ONE LIST, ONE PREVIEW, ONE SAVE. The scheme is an ordered list of parts, and BUILDING IT IS A
   * TABLE (owner ruling, 2026-09-11): one row per part, its fields in columns, edited the way every
   * other list in the product is edited. Moving a part and removing one are the row's own controls
   * and sit together at its END (owner ruling, 2026-09-19, reversing the arrows-lead ruling of
   * 2026-09-11): they are what you do TO the row rather than part of what it says, and the row says
   * its piece first. The list's last row is where a part is added and where an example is loaded.
   *
   * THE TABLE FITS ITS PLATE. Every cell sizes to what it holds, and nothing carries a fixed width:
   * a table wider than the settings column grows its own horizontal scrollbar inside the page's,
   * which is two bars for one list and hides the row's own controls off the right edge — which is
   * exactly what shipped on 2026-09-18 and what `pnpm run lint:settings-scroll` now refuses.
   *
   * A CELL A READER CANNOT TYPE INTO STATES WHAT THE PART WILL PUT THERE (owner ruling,
   * 2026-09-19), rather than standing empty and refused: the Office Code part's value cell reads
   * "RNO", because that is what the part contributes to the number. The value is the SERVER's — it
   * comes back with the preview, rendered by the same renderer that draws real numbers — so the
   * screen never composes a number or a piece of one.
   *
   * WHAT IS CURRENT STAYS ON SCREEN. The committed scheme is the first row of the plate, so a
   * half-edited list is never mistaken for the scheme the firm is numbering under. Discard returns
   * the list to it. A number already drawn is frozen whatever is saved here, and the line beside
   * Save says so.
   */
  import { untrack } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Switch from "@magna-carta/design-system/switch";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
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
    numberingCurrentDescriptor,
    numberingFrozenSentence,
    numberingSampleSentence,
    numberingSampleYear,
    numberingSavedSentence,
    numberingSchemeRefusal,
    numberingSchemesEqual,
    numberingStartersFor,
    numberSegmentCellRefusal,
    numberSegmentVocabularyFor,
    removeNumberSegment,
    replaceNumberSegment,
    type NumberingPurposeRecord,
    type NumberingSampleContext,
    type NumberSegment,
    type NumberSegmentKind,
  } from "./numbering-scheme.ts";

  let {
    record,
    sample,
    canManage,
    onRequestChange,
  }: {
    /** The purpose as the listing describes it, with what is in force at the time of the read. */
    record: NumberingPurposeRecord;
    /** The sample record the server rendered every example against; the preview uses the same. */
    sample: NumberingSampleContext;
    /** Whether the session may replace the scheme. Without it the scheme is read and stated. */
    canManage: boolean;
    /** Read-only only: mounts the per-row Request a change affordance on the Current row. */
    onRequestChange?: (definition: SettingDefinition) => void;
  } = $props();

  const identifier = $props.id();
  const purpose = $derived(record.purpose);
  const vocabulary = $derived(numberSegmentVocabularyFor(record.segmentKinds));
  const starters = $derived(numberingStartersFor(record));

  // What the server said is in force, as the listing carried it when this editor was drawn. Read
  // once on purpose: the editor owns the committed scheme from here (Save moves it), and the page
  // keys each editor by its purpose, so a record is never swapped under a mounted editor.
  const initial = untrack(() => record);
  let committed = $state<readonly NumberSegment[] | null>(initial.segments);
  let usingDefault = $state(initial.usingDefault);
  /** The first number the sample renders under what is in force, as the server rendered it. */
  let example = $state<string | null>(initial.example);
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
   * The examples control holds nothing at rest: choosing one loads it into the list and the control
   * empties again, because once a part has been changed the list is no longer that example, and a
   * field still naming it would be claiming something the table above contradicts.
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

  function removePart(index: number): void {
    draft = removeNumberSegment(draft, index);
    savedSentence = null;
  }

  function movePart(index: number, delta: -1 | 1): void {
    draft = moveNumberSegment(draft, index, delta);
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
    // The preview rendered the saved list against the sample at its first value, which is exactly
    // what the Current row shows; the server rendered it, so nothing is composed here.
    if (preview !== null) example = preview.number;
    savedSentence = numberingSavedSentence(record);
  }

  const KIND_CHOICES = $derived(
    vocabulary.map((entry) => ({
      value: entry.kind,
      label: entry.label,
      meaning: entry.description,
    })),
  );
  // Every year these choices name is the sample's, which the server sets to today: an example and
  // the digits picker never disagree with the preview beneath them in January.
  const sampleYear = $derived(numberingSampleYear(sample));
  const STARTER_CHOICES = $derived(
    starters.map((starter) => ({
      value: starter.key,
      label: starter.label,
      aside: starter.exampleFor(sampleYear),
    })),
  );
  // Named by the count, as the counter's own Digits field is, so the field fits the column; each
  // row carries what that count renders beside it, and the Value cell states the chosen one.
  const YEAR_DIGIT_CHOICES = $derived([
    { value: "4", label: "4", aside: sampleYear },
    { value: "2", label: "2", aside: sampleYear.slice(2) },
  ]);

  function numberOf(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  /** What the part at this row will put into the number, as the server's preview rendered it. */
  function partValue(index: number): string {
    return preview?.parts[index] ?? "";
  }

  // ---- the rows of the plate, as settings definitions ----------------------------------------

  // Current answers with the number the sample renders, and its one line under it is the parts that
  // render it — the built-in ones said to be so.
  const CURRENT_DEFINITION = $derived<SettingDefinition>({
    id: `numbering.${purpose}.current`,
    sectionId: "numbering",
    label: "Current",
    description: numberingCurrentDescriptor(record, committed, usingDefault),
    kind: "text",
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
</script>

<div class="flex flex-col divide-y divide-border-default">
  <!-- What is current, stated before anything is edited: a value engraved, never a control. -->
  <SettingsRow
    definition={CURRENT_DEFINITION}
    value={example ?? "Not set"}
    onRequestChange={canManage ? undefined : onRequestChange}
  />

  {#if canManage}
    <!-- The parts, as a table whose last row is where one is added and where an example is loaded:
         an entry row is the last row of its list, under the same rule as every other row
         (docs/conventions/design-corrections.md). -->
    <div class="py-12">
      <DataTable.Root>
        <DataTable.Caption class="sr-only">The parts of {record.title}</DataTable.Caption>
        <DataTable.Header>
          <DataTable.Row>
            <!-- THE TABLE FITS ITS COLUMN AT ANY WIDTH. Every column but Part is as narrow as what
                 it holds, Part takes whatever is left, and the one long heading may wrap: a
                 table sized from its content is what hid the row controls past the column's edge
                 behind a scrollbar of its own. -->
            <DataTable.Head class="w-full">Part</DataTable.Head>
            <DataTable.Head>Value</DataTable.Head>
            <DataTable.Head>Digits</DataTable.Head>
            <DataTable.Head>Starts At</DataTable.Head>
            <DataTable.Head class="whitespace-normal">Restarts the Count</DataTable.Head>
            <!-- A heading cell like the rest, so the header band runs the table's full width; only
                 its words are for a screen reader. -->
            <DataTable.Head><span class="sr-only">Move and remove</span></DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#if draft.length === 0}
            <DataTable.EmptyRow columns={6} title="No parts yet" />
          {/if}
          {#each draft as segment, index (index)}
            {@const valueRefusal = numberSegmentCellRefusal(segment.kind, "value")}
            {@const digitsRefusal = numberSegmentCellRefusal(segment.kind, "digits")}
            {@const startRefusal = numberSegmentCellRefusal(segment.kind, "start")}
            {@const scopingRefusal = numberSegmentCellRefusal(
              segment.kind,
              "scoping",
              record.scopeSource,
            )}
            <DataTable.Row>
              <DataTable.Cell>
                <!-- Part takes the table's spare width; the field stops at a width that holds
                     the longest part's name, so a wide window does not draw a field wider than
                     anything it will ever say. -->
                <div class="max-w-3xs">
                  <ChoicePicker
                    options={KIND_CHOICES}
                    inputId="{identifier}-kind-{index}"
                    label="Part {index + 1}"
                    fillsCell
                    disabled={saving}
                    bind:value={() => segment.kind, (next) => changeKind(index, next)}
                  />
                </div>
              </DataTable.Cell>
              <DataTable.Cell>
                {#if segment.kind === "literal"}
                  <Input
                    id="{identifier}-value-{index}"
                    class="w-64"
                    aria-label="Text of part {index + 1}"
                    value={segment.text}
                    disabled={saving}
                    oninput={(event) =>
                      update(index, { kind: "literal", text: event.currentTarget.value })}
                  />
                {:else}
                  <!-- Not a control: what this part puts into the number, from the server's own
                       rendering of the sample. -->
                  <span class="text-sm tabular-nums text-text-subtle" title={valueRefusal ?? undefined}>
                    {partValue(index)}
                  </span>
                {/if}
              </DataTable.Cell>
              <DataTable.Cell>
                {#if segment.kind === "year"}
                  <div class="w-64">
                    <ChoicePicker
                      options={YEAR_DIGIT_CHOICES}
                      inputId="{identifier}-digits-{index}"
                      label="Digits of part {index + 1}"
                      fillsCell
                      disabled={saving}
                      bind:value={
                        () => String(segment.digits),
                        (next) => update(index, { ...segment, digits: next === "2" ? 2 : 4 })
                      }
                    />
                  </div>
                {:else if segment.kind === "counter"}
                  <Input
                    id="{identifier}-digits-{index}"
                    class="w-64 tabular-nums"
                    type="number"
                    min="1"
                    max="12"
                    aria-label="Digits of part {index + 1}"
                    value={String(segment.padWidth)}
                    disabled={saving}
                    oninput={(event) =>
                      update(index, {
                        ...segment,
                        padWidth: numberOf(event.currentTarget.value, segment.padWidth),
                      })}
                  />
                {:else}
                  <span class="text-sm text-text-muted" title={digitsRefusal ?? undefined}></span>
                {/if}
              </DataTable.Cell>
              <DataTable.Cell>
                {#if segment.kind === "counter"}
                  <Input
                    id="{identifier}-start-{index}"
                    class="w-64 tabular-nums"
                    type="number"
                    min="1"
                    aria-label="Where part {index + 1} starts"
                    value={String(segment.start ?? 1)}
                    disabled={saving}
                    oninput={(event) =>
                      update(index, {
                        ...segment,
                        start: numberOf(event.currentTarget.value, segment.start ?? 1),
                      })}
                  />
                {:else}
                  <span class="text-sm text-text-muted" title={startRefusal ?? undefined}></span>
                {/if}
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
              <!-- What you do TO the row, at its end: move it, then remove it. -->
              <DataTable.Cell class="text-end">
                <span class="inline-flex items-center gap-4">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Move up"
                    aria-label="Move part {index + 1} up"
                    disabled={saving || index === 0}
                    onclick={() => movePart(index, -1)}
                  >
                    <ArrowUp class="size-16" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Move down"
                    aria-label="Move part {index + 1} down"
                    disabled={saving || index === draft.length - 1}
                    onclick={() => movePart(index, 1)}
                  >
                    <ArrowDown class="size-16" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Remove this part"
                    aria-label="Remove part {index + 1}"
                    disabled={saving}
                    onclick={() => removePart(index)}
                  >
                    <Trash2 class="size-16" aria-hidden="true" />
                  </Button>
                </span>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
          <DataTable.Row>
            <DataTable.Cell colspan={6}>
              <div class="flex flex-wrap items-center justify-between gap-12">
                <Button variant="ghost" size="sm" disabled={saving} onclick={addPart}>
                  <Plus class="size-16" aria-hidden="true" />
                  Add Part
                </Button>
                <!-- Examples to start from, not a choice of what a number may be: the list above is
                     the whole of that (owner ruling, 2026-09-19). -->
                <ChoicePicker
                  options={STARTER_CHOICES}
                  inputId="{identifier}-example"
                  label="Load an example"
                  disabled={saving}
                  bind:value={() => starterChoice, chooseStarter}
                />
              </div>
            </DataTable.Cell>
          </DataTable.Row>
        </DataTable.Body>
      </DataTable.Root>
    </div>

    <!-- The preview: the server's own rendering of the list against the sample record. -->
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
              <!-- An output, so the row's label names the number it labels. -->
              <output id="settings-{PREVIEW_DEFINITION.id}" class="text-lg tabular-nums">
                {preview.number}
              </output>
              <p class="text-end text-xs text-text-muted">
                {record.scopeSource === "owner"
                  ? `The count restarts for each ${record.subject === "time entry" ? "matter" : "letterhead"}.`
                  : preview.scopeKey === ""
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
