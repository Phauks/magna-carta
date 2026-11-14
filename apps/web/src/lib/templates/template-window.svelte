<script lang="ts">
  /*
   * One template, in the panel a thing is read in.
   *
   * A template is not edited here — there is no field of it a member changes in place — so it opens
   * as a reading panel rather than a record window: its facts, its standing, and beside them the two
   * acts a template takes. ADD TO MATTERS is refused, with the reason, unless the template stands
   * ready; ARCHIVE is offered only to a member who may manage the catalogue and opens its own
   * question over this one, so pressing it moves nothing here.
   *
   * WHAT THE VERSION BINDS IS READ ON OPENING. The listing carries a version handle and nothing
   * about the fields behind it; the field manifest is a second read, made only for a template
   * somebody opened deliberately and only where a current version exists. It says how many merge
   * fields the version binds, which keys, and — as warnings, in the same words the registration
   * report used — what it leaves unbound or frozen.
   *
   * Every door into a template opens THIS window, so a reader meets the same panel whichever way
   * they came.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { RecordSubject } from "@magna-carta/design-system/record-reference";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import Archive from "@lucide/svelte/icons/archive";
  import CopyPlus from "@lucide/svelte/icons/copy-plus";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    templatesArchive,
    templatesFieldsOptions,
    type TemplateSummary,
  } from "@magna-carta/api-client";
  import { failureOf } from "$lib/api/api-client.ts";
  import type { Failure } from "$lib/api/problem.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import {
    standingPresentation,
    templateLocationText,
    templateMatterTypeText,
    templateStanding,
    type TemplateVocabulary,
  } from "./template-columns.ts";
  import {
    bindingFindings,
    fieldCountSentence,
    MANAGE_TEMPLATES_PERMISSION,
    type TemplateKind,
  } from "./register-template.ts";

  let {
    open = $bindable(false),
    template,
    vocabulary,
    mayManage = false,
    onAddToMatters,
    onArchived,
  }: {
    open?: boolean;
    /** The template to read, or null when nothing is selected. */
    template: TemplateSummary | null;
    /** The firm's practice areas and Locations, so the handles read as names. */
    vocabulary: TemplateVocabulary;
    /** Whether this member may archive. Passed down: the surface already asked who is signed in. */
    mayManage?: boolean;
    /** Open the add panel over this one, with the kind where the field manifest has said it. */
    onAddToMatters: (template: TemplateSummary, kind: TemplateKind | null) => void;
    /** Called once the template is archived, so the surface can re-read and close this window. */
    onArchived: () => void;
  } = $props();

  const standing = $derived(template === null ? null : templateStanding(template));
  const presentation = $derived(standing === null ? null : standingPresentation(standing));

  const subtitle = $derived<RecordSubject>({ reference: { kind: "Template", number: null } });

  // The field manifest: read only while the window is open and only where a version has cleared
  // its checks — a template still being checked has nothing to read.
  const versionId = $derived(template?.currentVersionId ?? null);
  const readingFields = $derived(open && template !== null && versionId !== null);
  const fieldsRead = createQuery(() => ({
    ...templatesFieldsOptions({
      path: { templateId: template?.templateId ?? "", versionId: versionId ?? "" },
    }),
    enabled: readingFields,
  }));
  const manifest = $derived(fieldsRead.data ?? null);
  const fieldsFailure = $derived(fieldsRead.error === null ? null : failureOf(fieldsRead.error));
  const kind = $derived<TemplateKind | null>(manifest?.kind ?? null);

  const addRefusal = $derived.by((): string | undefined => {
    if (presentation === null) return "Reading the template.";
    if (standing === "ready") return undefined;
    return presentation.meaning;
  });
  const archiveRefusal = $derived.by((): string | undefined => {
    if (!mayManage) return permissionRefusal("Archiving a template", MANAGE_TEMPLATES_PERMISSION);
    if (standing === "archived") return "This template is already archived.";
    return undefined;
  });

  // ---- archiving: its own question, over this window ------------------------------------------

  let archiveOpen = $state(false);
  let archiveFailure = $state<Failure | null>(null);
  let archiveKey = crypto.randomUUID();

  async function archive(): Promise<ActionOutcome> {
    if (template === null) return "refused";
    archiveFailure = null;
    try {
      await templatesArchive({
        path: { templateId: template.templateId },
        headers: { "idempotency-key": archiveKey },
        throwOnError: true,
      });
    } catch (error) {
      archiveFailure = failureOf(error);
      return "refused";
    }
    archiveKey = crypto.randomUUID();
    onArchived();
    return "committed";
  }
</script>

<ActionDialog kind="reading" bind:open heading={template?.name ?? ""} {subtitle} width="wide">
  {#snippet fields()}
    {#if template !== null && presentation !== null}
      <div class="flex flex-col gap-16">
        <DefinitionList.Root>
          <DefinitionList.Row term="Standing">
            <!-- The two acts, seated beside the fact that decides them. A refused act is drawn and
                 disabled with its reason on the hover, never absent. -->
            <span class="flex flex-wrap items-center gap-8">
              <Badge variant={presentation.tone} title={presentation.meaning}>
                {presentation.label}
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                disabled={addRefusal !== undefined}
                title={addRefusal}
                onclick={() => onAddToMatters(template, kind)}
              >
                <CopyPlus class="size-16" aria-hidden="true" />
                Add to Matters
              </Button>
              {#if mayManage}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={archiveRefusal !== undefined}
                  title={archiveRefusal}
                  onclick={() => (archiveOpen = true)}
                >
                  <Archive class="size-16" aria-hidden="true" />
                  Archive
                </Button>
              {/if}
            </span>
          </DefinitionList.Row>
          <DefinitionList.Row term="Practice Area" empty={templateMatterTypeText(template, vocabulary) === ""}>
            {templateMatterTypeText(template, vocabulary)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Office" empty={templateLocationText(template, vocabulary) === ""}>
            {templateLocationText(template, vocabulary)}
          </DefinitionList.Row>
          <DefinitionList.Row term="Registered">{formatInstant(template.createdAt)}</DefinitionList.Row>
          <DefinitionList.Row term="Updated">{formatInstant(template.updatedAt)}</DefinitionList.Row>
          <DefinitionList.Row term="Description" empty={template.description === null}>
            {template.description}
          </DefinitionList.Row>
        </DefinitionList.Root>

        {#if addRefusal !== undefined && standing !== "ready"}
          <!-- A disabled control can be neither hovered nor focused on a touch device, so the
               refusal has to read where it stands. -->
          <p class="text-xs text-text-subtle">{addRefusal}</p>
        {/if}

        <div class="flex flex-col gap-8">
          <FieldLabel as="h3">Merge Fields</FieldLabel>
          {#if versionId === null}
            <Alert.Root variant="info">
              <Alert.Description>
                No version has cleared its checks yet, so there are no merge fields to read.
              </Alert.Description>
            </Alert.Root>
          {:else}
            <LoadingRegion
              loading={manifest === null && fieldsFailure === null}
              failed={fieldsFailure !== null}
              label="Reading the template's merge fields"
              onRetry={() => void fieldsRead.refetch()}
              class="flex flex-col gap-8"
            >
              {#snippet failure()}
                {#if fieldsFailure !== null}
                  <FailureNotice
                    failure={fieldsFailure}
                    title="The Merge Fields Could Not Be Read"
                    fallback="The template's merge fields could not be read."
                    onRetry={() => void fieldsRead.refetch()}
                  />
                {/if}
              {/snippet}
              {#snippet fixture()}
                <p class="text-sm">It binds several merge fields.</p>
                <div class="flex flex-wrap gap-4">
                  <Badge variant="outline">client.name</Badge>
                  <Badge variant="outline">matter.number</Badge>
                  <Badge variant="outline">matter.title</Badge>
                </div>
              {/snippet}
              {#if manifest !== null}
                <p class="text-sm">
                  {fieldCountSentence({ fieldCount: manifest.fields.length, kind: manifest.kind })}
                </p>
                {#if manifest.fields.length > 0}
                  <div class="flex flex-wrap gap-4">
                    {#each manifest.fields as field (field.key)}
                      <Badge variant="outline" title={field.description ?? undefined}>
                        {field.key}
                      </Badge>
                    {/each}
                  </div>
                {/if}
                {#each bindingFindings(manifest) as finding, index (index)}
                  <Alert.Root variant={finding.tone}>
                    <Alert.Description>{finding.text}</Alert.Description>
                  </Alert.Root>
                {/each}
              {/if}
            </LoadingRegion>
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={archiveOpen}
  kind="destructive"
  heading="Archive Template"
  subtitle={template === null ? {} : { facts: [template.name] }}
  commitLabel="Archive Template"
  commitBusyLabel="Archiving"
  unsavedChanges={false}
  onOpen={() => (archiveFailure = null)}
  onCommit={archive}
>
  {#snippet notice()}
    {#if archiveFailure !== null}
      <FailureNotice
        failure={archiveFailure}
        title="Nothing Changed"
        fallback="The template was not archived."
        whenSilent="Couldn't connect. The template wasn't archived."
      />
    {/if}
  {/snippet}

  {#snippet fields()}
    <p class="text-sm">
      Archiving removes the template from the catalog. Nothing new can be built from it, but documents already built from it are kept. Nothing is deleted.
    </p>
  {/snippet}
</ActionDialog>
