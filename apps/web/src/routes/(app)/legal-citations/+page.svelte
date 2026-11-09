<script lang="ts">
  /*
   * Legal Citations — paste a link or a rough citation, and the details are read beneath it; any
   * field the member types overrides what was read, and Undo puts the reading back. The citation
   * renders in the chosen court format in its full, short and Id. forms, each with Copy.
   *
   * All reading and formatting is @magna-carta/citations, which is pure and runs here in the
   * browser: a self-describing link (a code section, a regulation) is read whole with no request,
   * and a case link or citation is read as far as its own text goes. Provider lookups, which fill a
   * case's name, court and year from CourtListener, arrive with the Worker adapter; until then
   * those fields are the member's to add, and the screen says so field by field rather than in
   * prose. Runs outside any matter and stores nothing.
   */
  import Info from "@lucide/svelte/icons/info";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import FormattedCitation from "@magna-carta/design-system/formatted-citation";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Card from "@magna-carta/design-system/card";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as Select from "@magna-carta/design-system/select";
  import {
    AVAILABLE_SOURCES,
    CALIFORNIA_CODES,
    CITATION_KIND_NAMES,
    CITATION_KINDS,
    FIELD_LABELS,
    SHIPPED_FORMATS,
    SOURCE_NAMES,
    UNIFORM_FORMAT,
    applyReading,
    changeKind,
    draftValues,
    emptyDraft,
    formFieldsFor,
    formatCitation,
    isOverridingReading,
    overrideField,
    recognize,
    restoreField,
    type CitationDraft,
    type CitationFieldName,
    type CitationForm,
    type CitationKind,
    type Recognition,
  } from "@magna-carta/citations";
  import ScreenHeader from "$lib/screen/screen-header.svelte";

  let pasted = $state("");
  let recognition = $state<Recognition | null>(null);
  let draft = $state<CitationDraft>(emptyDraft("case"));
  let formatIdentifier = $state(UNIFORM_FORMAT.identifier);

  const format = $derived(
    SHIPPED_FORMATS.find((candidate) => candidate.identifier === formatIdentifier) ?? UNIFORM_FORMAT,
  );
  const values = $derived(draftValues(draft));
  const fieldNames = $derived(formFieldsFor(draft.kind, values));
  const full = $derived(formatCitation(draft.kind, values, format, "full"));
  const missing = $derived(new Set<CitationFieldName>(full.missing));
  const anyValue = $derived(Object.keys(values).length > 0);

  // Only a source the firm can use is listed: a provider that needs a connection appears once it
  // is connected, and none is yet.
  const usableSources = AVAILABLE_SOURCES.filter((source) => !source.needsConnection);

  const FORMS: readonly { form: CitationForm; label: string }[] = [
    { form: "full", label: "Full Citation" },
    { form: "short", label: "Short Form" },
    { form: "id", label: "Immediately Following the Same Source" },
  ];

  const californiaCodeItems = CALIFORNIA_CODES.map((code) => ({ value: code.lawCode, label: code.name }));
  const kindItems = CITATION_KINDS.map((kind) => ({ value: kind, label: CITATION_KIND_NAMES[kind] }));
  const formatItems = SHIPPED_FORMATS.map((candidate) => ({
    value: candidate.identifier,
    label: candidate.name,
  }));

  function readPasted(): void {
    const found = recognize(pasted);
    recognition = found;
    if (found === null || found.kind === null) return;
    // A new paste starts a new citation, but what the member typed into a field the new reading
    // also fills is theirs and stays.
    const base = found.kind === draft.kind ? draft : changeKind(draft, found.kind);
    draft = applyReading({ ...base, read: {} }, found.fields, "link");
  }

  function provenanceOf(name: CitationFieldName): "link" | "edited" | "missing" | null {
    if (isOverridingReading(draft, name)) return "edited";
    const field = draft.fields[name];
    if (field !== undefined && field.value.trim() !== "" && field.source !== "typed") return "link";
    if (anyValue && missing.has(name)) return "missing";
    return null;
  }

  const unpublished = $derived(values.unpublished === "yes");
</script>

<ScreenHeader title="Legal Citations" class="mb-24">
  {#snippet actions()}
    <div class="flex items-center gap-8">
      <Label id="citation-format-label" class="text-sm text-text-muted">Format</Label>
      <Select.Root
        type="single"
        items={formatItems}
        bind:value={() => formatIdentifier, (picked) => (formatIdentifier = picked || UNIFORM_FORMAT.identifier)}
      >
        <Select.Trigger aria-labelledby="citation-format-label" class="w-3xs">
          <Select.Value placeholder={UNIFORM_FORMAT.name} />
        </Select.Trigger>
        <Select.Content>
          {#each formatItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/snippet}
</ScreenHeader>

<div class="grid grid-cols-1 gap-24 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
  <section class="flex flex-col gap-16" aria-label="Source">
    <div class="flex flex-col gap-8">
      <div class="flex items-center gap-4">
        <Label for="citation-pasted">Paste a Link or a Citation</Label>
        <Popover.Root>
          <Popover.Trigger
            class="inline-flex size-24 items-center justify-center rounded-full text-text-link"
            aria-label="Available Sources"
          >
            <Info class="size-16" aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Content align="start" class="flex w-xs flex-col gap-4">
            <FieldLabel as="h2">Available Sources</FieldLabel>
            <ul class="flex flex-col gap-2 text-sm text-text-default">
              {#each usableSources as source (source.name)}
                <li>{source.name}</li>
              {/each}
              <li class="text-text-muted">A plain citation, like 347 us 483</li>
            </ul>
          </Popover.Content>
        </Popover.Root>
      </div>
      <form
        class="flex items-center gap-8"
        onsubmit={(event) => {
          event.preventDefault();
          readPasted();
        }}
      >
        <Input
          id="citation-pasted"
          bind:value={pasted}
          oninput={readPasted}
          autocomplete="off"
          spellcheck={false}
          placeholder="https://www.law.cornell.edu/uscode/text/42/1983"
        />
      </form>
      {#if recognition !== null}
        <p class="text-sm text-text-muted" aria-live="polite">
          Read from {SOURCE_NAMES[recognition.source]}
        </p>
      {:else if pasted.trim() !== ""}
        <p class="text-sm text-text-muted" aria-live="polite">Not recognized. Enter the details below.</p>
      {/if}
    </div>

    <div class="flex flex-col gap-8">
      <Label id="citation-kind-label">Type</Label>
      <Select.Root
        type="single"
        items={kindItems}
        bind:value={() => draft.kind, (picked) => (draft = changeKind(draft, (picked as CitationKind) || "case"))}
      >
        <Select.Trigger aria-labelledby="citation-kind-label">
          <Select.Value placeholder="Case" />
        </Select.Trigger>
        <Select.Content>
          {#each kindItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    {#if draft.kind === "case"}
      <div class="flex items-center gap-8">
        <Checkbox
          id="citation-unpublished"
          checked={unpublished}
          onCheckedChange={(checked) => (draft = overrideField(draft, "unpublished", checked ? "yes" : ""))}
        />
        <Label for="citation-unpublished">Unpublished Disposition</Label>
      </div>
    {/if}

    <div class="grid grid-cols-1 gap-16 sm:grid-cols-2">
      {#each fieldNames as name (name)}
        {@const provenance = provenanceOf(name)}
        <div class={["flex flex-col gap-4", (name === "caseName" || name === "parenthetical" || name === "californiaCode") && "sm:col-span-2"]}>
          <div class="flex h-24 items-center gap-8">
            <Label for={`citation-field-${name}`}>{FIELD_LABELS[name]}</Label>
            {#if provenance === "link"}
              <span class="text-xs text-text-success">from link</span>
            {:else if provenance === "edited"}
              <span class="text-xs text-text-link">edited</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Undo ${FIELD_LABELS[name]}`}
                onclick={() => (draft = restoreField(draft, name))}
              >
                <Undo2 aria-hidden="true" />
              </Button>
            {:else if provenance === "missing"}
              <span class="text-xs text-text-warning">you add</span>
            {/if}
          </div>
          {#if name === "californiaCode"}
            <Select.Root
              type="single"
              items={californiaCodeItems}
              bind:value={() => draft.fields.californiaCode?.value ?? "", (picked) => (draft = overrideField(draft, "californiaCode", picked))}
            >
              <Select.Trigger id={`citation-field-${name}`}>
                <Select.Value placeholder="Code" />
              </Select.Trigger>
              <Select.Content>
                {#each californiaCodeItems as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {:else}
          <Input
            id={`citation-field-${name}`}
            value={draft.fields[name]?.value ?? ""}
            oninput={(event) => (draft = overrideField(draft, name, event.currentTarget.value))}
            autocomplete="off"
            placeholder={name === "dateDecided" || name === "date" ? "YYYY-MM-DD" : undefined}
          />
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-16" aria-label="Citation">
    {#each FORMS as entry (entry.form)}
      {@const result = formatCitation(draft.kind, values, format, entry.form)}
      <Card.Root>
        <Card.Content class="flex flex-col gap-8">
          <FieldLabel as="h2">{entry.label}</FieldLabel>
          <FormattedCitation
            runs={anyValue ? result.runs : []}
            incomplete={result.missing.length > 0}
            copyLabel={`Copy ${entry.label}`}
          />
          {#if anyValue && result.rules.length > 0}
            <p class="text-xs text-text-muted">
              {result.rules.join(" · ")}
            </p>
          {/if}
        </Card.Content>
      </Card.Root>
    {/each}

    {#each full.notices as notice (notice.message)}
      <Alert.Root variant={notice.severity === "error" ? "danger" : "warning"}>
        <Alert.Title>{notice.rule}</Alert.Title>
        <Alert.Description>{notice.message}</Alert.Description>
      </Alert.Root>
    {/each}
  </section>
</div>
