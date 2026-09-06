<script lang="ts">
  /*
   * The editor for one of the firm's two numbering schemes: the template its matter numbers
   * follow, or the one its consultation numbers follow.
   *
   * ONE LIST, ONE PREVIEW, ONE SAVE. The scheme is an ordered list of parts, edited in place: each
   * row is a part with its kind and the one or two facts that kind takes, and the rows move up and
   * down. Beneath the list the server renders the list against a sample matter as the reader types,
   * so the number a scheme produces is seen before it is saved rather than discovered on the first
   * matter opened under it. Save replaces the firm's scheme in one audited write.
   *
   * THE PREVIEW IS THE SERVER'S. The same renderer that draws real numbers renders the sample; this
   * component never composes a number itself, so what it shows is what a matter will get. It asks
   * only when the list passes the one rule it can check here (exactly one counter, and text that
   * can stand in a link), and it asks a moment after the last keystroke rather than on every one.
   *
   * WHAT IS IN FORCE STAYS ON SCREEN. The committed scheme is printed as its own line above the
   * editor, so a half-edited list is never mistaken for the scheme the firm is numbering under.
   * Discard returns the list to it. A number already drawn is frozen whatever is saved here, and
   * the sentence under the editor says so.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Select from "@magna-carta/design-system/select";
  import Switch from "@magna-carta/design-system/switch";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    previewNumberingScheme,
    readNumberingScheme,
    setNumberingScheme,
    type NumberingPreview,
  } from "./numbering-api.ts";
  import {
    isScoping,
    isScopingCapable,
    moveNumberSegment,
    newNumberSegment,
    NUMBER_SEGMENT_VOCABULARY,
    NUMBERING_STARTERS,
    numberingPurposeLabel,
    numberingSampleContext,
    numberingSampleSentence,
    numberingSchemeRefusal,
    numberingSchemesEqual,
    numberSegmentSummary,
    numberSegmentVocabulary,
    removeNumberSegment,
    replaceNumberSegment,
    type NumberingPurpose,
    type NumberSegment,
    type NumberSegmentKind,
  } from "./numbering-scheme.ts";

  let {
    purpose,
    canManage,
    today,
  }: {
    purpose: NumberingPurpose;
    /** Whether the session may replace the scheme. Without it the scheme is read and stated. */
    canManage: boolean;
    /** The civil date the sample matter opened on, so the preview's year is today's. */
    today: string;
  } = $props();

  const identifier = $props.id();
  const sample = numberingSampleContext(today);

  /** What the server said is in force. Null until the read lands. */
  let committed = $state<readonly NumberSegment[] | null>(null);
  let usingDefault = $state(false);
  let loaded = $state(false);
  let readFailure = $state<StatedFailure | null>(null);

  /** The list under edit. Starts as the committed scheme and is returned to it by Discard. */
  let draft = $state<readonly NumberSegment[]>([]);
  let saving = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  let savedSentence = $state<string | null>(null);

  const refusal = $derived(numberingSchemeRefusal(draft));
  const changed = $derived(!numberingSchemesEqual(draft, committed));

  /** The server's rendering of the draft, or its refusal, or nothing while it has not answered. */
  let preview = $state<NumberingPreview | null>(null);
  let previewFailure = $state<StatedFailure | null>(null);

  async function load(): Promise<void> {
    const outcome = await readNumberingScheme(fetch, purpose);
    if (outcome.kind !== "ok") {
      readFailure = stated(outcome.failure, "The firm's numbering scheme could not be read.");
      loaded = true;
      return;
    }
    readFailure = null;
    committed = outcome.value.segments;
    usingDefault = outcome.value.usingDefault;
    draft = outcome.value.segments ?? [];
    loaded = true;
  }

  $effect(() => {
    void load();
  });

  // The preview follows the draft a moment behind the last edit. A list that fails the counter rule
  // is not sent: the server would refuse it, and the refusal is already on the screen.
  $effect(() => {
    const segments = draft;
    const refused = refusal;
    if (!loaded) return;
    if (refused !== null || segments.length === 0) {
      preview = null;
      previewFailure = null;
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        const outcome = await previewNumberingScheme(fetch, segments, sample);
        // A later edit may have superseded this request; only the newest answer is shown.
        if (segments !== draft) return;
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

  function chooseStarter(next: string | string[] | undefined): void {
    const key = Array.isArray(next) ? (next[0] ?? "") : (next ?? "");
    const starter = NUMBERING_STARTERS.find((candidate) => candidate.key === key);
    if (starter !== undefined) draft = [...starter.segments];
    savedSentence = null;
  }

  function addPart(): void {
    // A first part is the counter every scheme needs; after that, the text that separates parts.
    const kind: NumberSegmentKind = draft.some((segment) => segment.kind === "counter")
      ? "literal"
      : "counter";
    draft = [...draft, newNumberSegment(kind)];
    savedSentence = null;
  }

  function changeKind(index: number, next: string | string[] | undefined): void {
    const kind = (Array.isArray(next) ? next[0] : next) as NumberSegmentKind | undefined;
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
    savedSentence =
      purpose === "matter"
        ? "Saved. Matters opened from now on draw their number from this scheme; numbers already drawn are unchanged."
        : "Saved. Consultations recorded from now on draw their number from this scheme; numbers already drawn are unchanged.";
  }

  const KIND_ITEMS = NUMBER_SEGMENT_VOCABULARY.map((entry) => ({
    value: entry.kind,
    label: entry.label,
  }));
  const STARTER_ITEMS = NUMBERING_STARTERS.map((starter) => ({
    value: starter.key,
    label: `${starter.label} (${starter.example})`,
  }));

  function numberOf(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
</script>

<div class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16 border-b border-border-strong pb-8">
    <FieldLabel as="h2">{numberingPurposeLabel(purpose)}</FieldLabel>
    {#if loaded && committed === null && !readFailure}
      <Badge variant="warning">Not set</Badge>
    {:else if usingDefault}
      <Badge variant="neutral">Built-in sequence</Badge>
    {/if}
  </div>

  {#if readFailure !== null}
    <FailureNotice
      failure={readFailure.failure}
      title="The Scheme Could Not Be Read"
      fallback={readFailure.fallback}
      onRetry={() => void load()}
    />
  {/if}

  <LoadingRegion loading={!loaded} label="Reading the scheme" class="flex flex-col gap-16">
    {#snippet fixture()}
      <p class="text-sm">2026-0001</p>
      <p class="text-xs text-text-muted">Year, 4 digits, restarts the count · "-" · Counter, 4 digits</p>
    {/snippet}

    <!-- What is in force, stated before anything is edited. -->
    <dl class="flex flex-col gap-4 text-sm">
      <div class="grid grid-cols-4 items-baseline gap-16">
        <dt class="text-text-muted">In force</dt>
        <dd class="col-span-3">
          {#if committed === null}
            <span class="text-text-subtle">
              {purpose === "matter"
                ? "Nothing. A matter cannot open until a scheme is set, because its number is drawn at that moment and never changes."
                : "Nothing of the firm's; the built-in sequence numbers consultations until one is set."}
            </span>
          {:else}
            <span class="text-text-muted">
              {committed.map(numberSegmentSummary).join(" · ")}
            </span>
          {/if}
        </dd>
      </div>
    </dl>

    {#if canManage}
      <div class="flex flex-col gap-12 rounded-md border border-border-strong p-16">
        <div class="flex flex-wrap items-end justify-between gap-12">
          <div class="flex flex-col gap-4">
            <Label for="{identifier}-starter">Start from</Label>
            <Select.Root
              type="single"
              items={STARTER_ITEMS}
              onValueChange={chooseStarter}
              disabled={saving}
            >
              <Select.Trigger id="{identifier}-starter" class="w-xs">
                <Select.Value placeholder="A common shape" />
              </Select.Trigger>
              <Select.Content>
                {#each STARTER_ITEMS as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <Button variant="secondary" disabled={saving} onclick={addPart}>
            <Plus aria-hidden="true" />
            Add Part
          </Button>
        </div>

        {#if draft.length === 0}
          <p class="text-xs text-text-muted">
            No parts yet. Start from a common shape, or add a part.
          </p>
        {:else}
          <ol class="flex flex-col gap-8">
            {#each draft as segment, index (index)}
              {@const vocabulary = numberSegmentVocabulary(segment.kind)}
              <li class="flex flex-wrap items-end gap-12 border-t border-border-subtle pt-8">
                <div class="flex flex-col gap-4">
                  <Label for="{identifier}-kind-{index}">Part {index + 1}</Label>
                  <Select.Root
                    type="single"
                    items={KIND_ITEMS}
                    value={segment.kind}
                    onValueChange={(next) => changeKind(index, next)}
                    disabled={saving}
                  >
                    <Select.Trigger id="{identifier}-kind-{index}" class="w-xs">
                      {vocabulary.label}
                    </Select.Trigger>
                    <Select.Content>
                      {#each KIND_ITEMS as item (item.value)}
                        <Select.Item value={item.value} label={item.label} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>

                {#if segment.kind === "literal"}
                  <div class="flex flex-col gap-4">
                    <Label for="{identifier}-text-{index}">Text</Label>
                    <Input
                      id="{identifier}-text-{index}"
                      class="w-3xs"
                      value={segment.text}
                      disabled={saving}
                      oninput={(event) =>
                        update(index, { kind: "literal", text: event.currentTarget.value })}
                    />
                  </div>
                {:else if segment.kind === "counter"}
                  <div class="flex flex-col gap-4">
                    <Label for="{identifier}-width-{index}">Digits</Label>
                    <Input
                      id="{identifier}-width-{index}"
                      class="w-3xs"
                      type="number"
                      min="1"
                      max="12"
                      value={String(segment.padWidth)}
                      disabled={saving}
                      oninput={(event) =>
                        update(index, {
                          ...segment,
                          padWidth: numberOf(event.currentTarget.value, segment.padWidth),
                        })}
                    />
                  </div>
                  <div class="flex flex-col gap-4">
                    <Label for="{identifier}-start-{index}">Starts at</Label>
                    <Input
                      id="{identifier}-start-{index}"
                      class="w-3xs"
                      type="number"
                      min="1"
                      value={String(segment.start ?? 1)}
                      disabled={saving}
                      oninput={(event) =>
                        update(index, {
                          ...segment,
                          start: numberOf(event.currentTarget.value, segment.start ?? 1),
                        })}
                    />
                  </div>
                {:else if segment.kind === "year"}
                  <div class="flex flex-col gap-4">
                    <Label for="{identifier}-digits-{index}">Digits</Label>
                    <Select.Root
                      type="single"
                      items={[
                        { value: "4", label: "Four (2026)" },
                        { value: "2", label: "Two (26)" },
                      ]}
                      value={String(segment.digits)}
                      onValueChange={(next) =>
                        update(index, {
                          ...segment,
                          digits: (Array.isArray(next) ? next[0] : next) === "2" ? 2 : 4,
                        })}
                      disabled={saving}
                    >
                      <Select.Trigger id="{identifier}-digits-{index}" class="w-3xs">
                        {segment.digits === 2 ? "Two (26)" : "Four (2026)"}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="4" label="Four (2026)" />
                        <Select.Item value="2" label="Two (26)" />
                      </Select.Content>
                    </Select.Root>
                  </div>
                {/if}

                {#if isScopingCapable(segment)}
                  <div class="flex items-center gap-8 pb-4">
                    <Switch
                      id="{identifier}-scoping-{index}"
                      checked={isScoping(segment)}
                      onCheckedChange={(checked) => setScoping(index, checked)}
                      disabled={saving}
                    />
                    <Label for="{identifier}-scoping-{index}">Restarts the count</Label>
                  </div>
                {/if}

                <span class="grow text-xs text-text-muted">{vocabulary.description}</span>

                <div class="flex gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Move up"
                    aria-label="Move part {index + 1} up"
                    disabled={saving || index === 0}
                    onclick={() => (draft = moveNumberSegment(draft, index, -1))}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Move down"
                    aria-label="Move part {index + 1} down"
                    disabled={saving || index === draft.length - 1}
                    onclick={() => (draft = moveNumberSegment(draft, index, 1))}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Remove"
                    aria-label="Remove part {index + 1}"
                    disabled={saving}
                    onclick={() => (draft = removeNumberSegment(draft, index))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              </li>
            {/each}
          </ol>
        {/if}

        <!-- The preview: the server's own rendering of the list against a sample matter. -->
        <div class="flex flex-col gap-4 border-t border-border-subtle pt-8">
          <FieldLabel as="h3">Preview</FieldLabel>
          {#if refusal !== null}
            <p class="text-sm text-status-danger-subtle-foreground">{refusal}</p>
          {:else if previewFailure !== null}
            <FailureNotice
              failure={previewFailure.failure}
              title="The Scheme Could Not Be Previewed"
              fallback={previewFailure.fallback}
              whenSilent={previewFailure.whenSilent}
            />
          {:else if preview === null}
            <p class="text-sm text-text-subtle">Rendering.</p>
          {:else}
            <p class="text-lg tabular-nums">{preview.number}</p>
            <p class="text-xs text-text-muted">
              {preview.scopeKey === ""
                ? "One count across the whole firm."
                : `The count restarts for each ${preview.scopeKey.split(":").length === 1 ? "value" : "combination"} of the parts that restart it; this sample counts under "${preview.scopeKey}".`}
            </p>
          {/if}
          <p class="text-xs text-text-subtle">{numberingSampleSentence(sample)}</p>
        </div>

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
          <p class="text-xs text-text-muted">{savedSentence}</p>
        {/if}

        <div class="flex flex-wrap items-center justify-between gap-12">
          <p class="text-xs text-text-subtle">
            A number already drawn is frozen. Saving reaches only the matters numbered from now on.
          </p>
          <div class="flex gap-8">
            <Button variant="secondary" disabled={saving || !changed} onclick={discard}>Discard</Button>
            <Button disabled={saving || !changed || refusal !== null} onclick={() => void save()}>
              {saving ? "Saving" : "Save Scheme"}
            </Button>
          </div>
        </div>
      </div>
    {/if}
  </LoadingRegion>
</div>
