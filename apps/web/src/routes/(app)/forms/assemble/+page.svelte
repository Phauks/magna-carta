<script lang="ts">
  /*
   * Assemble a document — the field-input surface, as a working scaffold.
   *
   * WHAT IS REAL HERE: the shape of the interaction. A person picks a template, sees exactly which
   * of its placeholders they have to fill in and which fill themselves, confirms any placeholders
   * detected in the uploaded document, fills the form, and gets told what is standing in the way.
   * That flow, its typed controls, its grouping, and its validation are the infrastructure.
   *
   * WHAT IS NOT REAL YET: the data. Every field, template, and proposal comes from the in-repo
   * fixture catalog through the mock provider (lib/document-assembly/merge-field-catalog-source.ts,
   * the one place that changes when the live endpoints land), and choosing Assemble reports the
   * collected values rather than starting a job. The submit route itself is NOT the gap — it exists
   * (apps/api-worker/src/http/routes/documents/assemblies.ts, POST /api/v1/matters/{matterId}/assemblies, with a poll
   * beside it). What this surface still lacks is the matter it would submit against and a template
   * catalog read from the server rather than from fixtures, which is the same wiring the mock
   * provider stands in for.
   *
   * The visual design is deliberately plain: this is the structure for the owner to design against,
   * built from design-system components and tokens so that reshaping it is a layout question rather
   * than a rebuild.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Card from "@magna-carta/design-system/card";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import * as Select from "@magna-carta/design-system/select";
  import MergeFieldPicker from "@magna-carta/design-system/merge-field-picker";
  import MergeFieldReviewList from "@magna-carta/design-system/merge-field-review-list";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import {
    sampleAmount,
    sampleDate,
    sampleMatter,
  } from "@magna-carta/design-system/loading-fixtures";
  import Label from "@magna-carta/design-system/label";
  import type {
    MergeFieldCatalog,
    MergeFieldValueType,
    TemplateFieldManifest,
    TemplateVersionSummary,
  } from "@magna-carta/merge-field-catalog-contract/types";
  import { MaturityBadge } from "@magna-carta/design-system/maturity";
  import AssemblyInputArea from "$lib/document-assembly/assembly-input-area.svelte";
  import {
    buildAssemblyInputPlan,
    type AssemblyFieldDisposition,
    type AssemblyInputField,
    type AssemblyInputPlan,
  } from "$lib/document-assembly/assembly-input-model.ts";
  import { catalogPickerOptions, reviewItems } from "$lib/document-assembly/catalog-adapters.ts";
  import { mergeFieldCatalogProvider } from "$lib/document-assembly/merge-field-catalog-source.ts";

  const provider = mergeFieldCatalogProvider();

  let catalog = $state<MergeFieldCatalog | null>(null);
  let templateVersions = $state<readonly TemplateVersionSummary[]>([]);
  let manifest = $state<TemplateFieldManifest | null>(null);
  // True while a template's manifest is being read. Choosing another template re-reads with the
  // previous plan still on screen, so the form does not fall back to its shape mid-visit.
  let manifestReading = $state(false);
  let selectedTemplateVersionId = $state("");
  let confirmedConversionIds = $state<ReadonlySet<string>>(new Set());
  let browsedFieldKey = $state<string | null>(null);
  let submittedFieldCount = $state<number | null>(null);

  // The catalog and the template list are read once; the manifest is re-read per template.
  $effect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedCatalog, versions] = await Promise.all([
        provider.listMergeFields(),
        provider.listTemplateVersions(),
      ]);
      if (cancelled) return;
      catalog = loadedCatalog;
      templateVersions = versions;
      selectedTemplateVersionId ||= versions[0]?.templateVersionId ?? "";
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const templateVersionId = selectedTemplateVersionId;
    if (templateVersionId === "") return;
    let cancelled = false;
    manifestReading = true;
    void (async () => {
      const loaded = await provider.getTemplateFieldManifest(templateVersionId);
      if (cancelled) return;
      manifestReading = false;
      manifest = loaded;
      confirmedConversionIds = new Set();
      submittedFieldCount = null;
    })();
    return () => {
      cancelled = true;
    };
  });

  const pickerOptions = $derived(catalog ? catalogPickerOptions(catalog) : []);
  const plan = $derived(catalog && manifest ? buildAssemblyInputPlan(manifest, catalog) : null);
  const proposals = $derived(
    catalog && manifest
      ? reviewItems(manifest.detectedConversions, catalog, confirmedConversionIds)
      : [],
  );
  const templateItems = $derived(
    templateVersions.map((version) => ({
      value: version.templateVersionId,
      label: version.templateName,
    })),
  );

  function recordConfirmation(id: string, confirmed: boolean): void {
    const next = new Set(confirmedConversionIds);
    if (confirmed) next.add(id);
    else next.delete(id);
    confirmedConversionIds = next;
  }

  function recordSubmission(values: Record<string, string>): void {
    submittedFieldCount = Object.keys(values).length;
  }

  /*
   * The shapes the two reads take while they are in flight: the same picker over invented
   * templates, and the same input area over an invented plan whose values come from the sample
   * vocabulary. Inert and hidden from assistive technology while they stand, so nothing in them
   * can be picked or filled in.
   */
  const FIXTURE_TEMPLATE_VALUE = "fixture-engagement";
  const TEMPLATE_FIXTURE_ITEMS = [
    { value: FIXTURE_TEMPLATE_VALUE, label: "Engagement letter" },
    { value: "fixture-retainer", label: "Retainer agreement" },
  ];

  function fixtureField(
    key: string,
    label: string,
    valueType: MergeFieldValueType,
    valueTypeLabel: string,
    disposition: AssemblyFieldDisposition,
    exampleRendering: string,
  ): AssemblyInputField {
    const requiresEntry = disposition === "manual" || disposition === "conditional";
    return {
      key,
      label,
      valueType,
      valueTypeLabel,
      description: `The ${label.toLowerCase()} as it appears in the document.`,
      availabilityNote: requiresEntry ? "Nothing on file supplies this." : "Filled from the matter.",
      exampleRendering,
      occurrences: 1,
      disposition,
      sensitivity: "ordinary",
      requiresEntry,
      required: requiresEntry,
    };
  }

  const PLAN_FIXTURE: AssemblyInputPlan = {
    templateVersionId: FIXTURE_TEMPLATE_VALUE,
    templateName: "Engagement letter",
    groups: [
      {
        group: "client",
        label: "Client",
        fields: [
          fixtureField("client.name", "Client name", "name", "Name", "automatic", sampleMatter(1).client),
          fixtureField("client.address", "Client address", "text", "Text", "manual", "14 Cascade Ridge"),
        ],
      },
      {
        group: "matter",
        label: "Matter",
        fields: [
          fixtureField("matter.title", "Matter title", "text", "Text", "automatic", sampleMatter(1).title),
          fixtureField("matter.opened", "Date opened", "date", "Date", "automatic", sampleDate(0)),
          fixtureField("matter.retainer", "Retainer amount", "money", "Money", "manual", sampleAmount(0)),
        ],
      },
    ],
    entryFieldCount: 2,
    automaticFieldCount: 3,
    unrecognizedKeys: [],
    protectedKeys: [],
  };
</script>

<svelte:head><title>Assemble a document · Magna Carta</title></svelte:head>

<ScreenHeader
  title="Assemble a document"
  class="mb-24"
>
  {#snippet meta()}
    <MaturityBadge stage="alpha" />
  {/snippet}
</ScreenHeader>

<div class="flex max-w-3xl flex-col gap-24">
  <Alert.Root variant="info">
    <Alert.Title>This surface runs on sample data.</Alert.Title>
    <Alert.Description>
      The templates, merge fields, and suggestions below are invented examples, not your firm's.
      Nothing here reads or writes a matter.
    </Alert.Description>
  </Alert.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Template</Card.Title>
      <Card.Description>Choose the template this document comes from.</Card.Description>
    </Card.Header>
    <Card.Content>
      <LoadingRegion loading={catalog === null} label="Reading the firm's templates">
        {#snippet fixture()}
          <Select.Root
            type="single"
            items={TEMPLATE_FIXTURE_ITEMS}
            value={FIXTURE_TEMPLATE_VALUE}
            allowDeselect={false}
          >
            <Select.Trigger class="max-w-sm" aria-label="Template">
              <Select.Value />
            </Select.Trigger>
          </Select.Root>
        {/snippet}
        <Select.Root
          type="single"
          items={templateItems}
          bind:value={selectedTemplateVersionId}
          allowDeselect={false}
        >
          <Select.Trigger class="max-w-sm" aria-label="Template">
            <Select.Value placeholder="Choose a template" />
          </Select.Trigger>
          <Select.Content>
            {#each templateVersions as version (version.templateVersionId)}
              <Select.Item value={version.templateVersionId} label={version.templateName} />
            {/each}
          </Select.Content>
        </Select.Root>
      </LoadingRegion>
    </Card.Content>
  </Card.Root>

  {#if proposals.length > 0}
    <Card.Root>
      <Card.Content>
        <MergeFieldReviewList
          items={proposals}
          headingLevel={2}
          onToggle={recordConfirmation}
        />
      </Card.Content>
    </Card.Root>
  {/if}

  <LoadingRegion
    loading={plan === null}
    refreshing={manifestReading}
    label="Reading what this template needs"
  >
    {#snippet fixture()}
      <AssemblyInputArea plan={PLAN_FIXTURE} />
    {/snippet}
    {#if plan !== null}
      <AssemblyInputArea {plan} onSubmit={recordSubmission} />
    {/if}
  </LoadingRegion>

  {#if submittedFieldCount !== null}
    <Alert.Root variant="success">
      <Alert.Title>Collected {submittedFieldCount} values.</Alert.Title>
      <Alert.Description>
        There is no assembly service to send them to yet, so nothing was filed. This is where the
        assembly job starts once the automation API is in place.
      </Alert.Description>
    </Alert.Root>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>Browse the firm's merge fields</Card.Title>
      <Card.Description>
        The same picker a template author uses when adding a field, over the firm's whole catalog.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <div class="flex max-w-sm flex-col gap-8">
        <Label id="merge-field-browser-label">Merge field</Label>
        <MergeFieldPicker
          options={pickerOptions}
          bind:value={browsedFieldKey}
          aria-labelledby="merge-field-browser-label"
        />
      </div>
    </Card.Content>
  </Card.Root>
</div>
