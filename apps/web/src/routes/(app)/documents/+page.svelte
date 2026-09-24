<script lang="ts">
  /*
   * Documents — the firm's template library.
   *
   * A template belongs to the FIRM rather than to any one matter: a Word document carrying
   * {{field}} placeholders, or a fillable PDF form, registered once and added to as many matters
   * as need it. A matter's own Files page builds ONE document from one of these; this screen is
   * where the catalogue those documents are built from is read, added to, and withdrawn from.
   *
   * IT IS ONE TABLE, AND THE TABLE IS WHAT NARROWS IT. Standing, practice area and office are
   * columns with their own set filters, summoned from their own headers. The search in the masthead
   * is the listing's own `search`, so it reads the whole catalogue rather than the page in the
   * browser, and it waits for typing to pause because the read leaves the machine.
   *
   * THE ARCHIVED TEMPLATES ARE ASKED FOR AT THE FOOT. Showing them WIDENS the list rather than
   * narrowing it, so the control lives after everything the list is for has been read, and is
   * undone by its own label rather than by the clear control (docs/conventions/design-corrections.md,
   * "A control that WIDENS the list does not sit in the row that narrows it").
   *
   * EVERY DOOR INTO A TEMPLATE OPENS THE SAME WINDOW. A row activated in the register, and the
   * template a dialog was opened from, are one record read in one place; the window carries the
   * two acts a template takes — adding it to matters, and archiving it — beside the facts.
   *
   * The whole screen is gated server-side by documents:assemble: a member refused the listing sees
   * the failure's own words in the register's notice, and nothing here invents a second gate.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { createQuery } from "@tanstack/svelte-query";
  import {
    locationsListOptions,
    matterTypesListOptions,
    meGetOptions,
    templatesListQueryKey,
    type TemplateSummary,
  } from "@magna-carta/api-client";
  import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import {
    EMPTY_TEMPLATE_VOCABULARY,
    templateVocabulary,
  } from "$lib/templates/template-columns.ts";
  import {
    MANAGE_TEMPLATES_PERMISSION,
    type TemplateKind,
  } from "$lib/templates/register-template.ts";
  import TemplateRegister from "$lib/templates/template-register.svelte";
  import NewTemplateDialog from "$lib/templates/new-template-dialog.svelte";
  import TemplateWindow from "$lib/templates/template-window.svelte";
  import AddToMattersDialog from "$lib/templates/add-to-matters-dialog.svelte";

  // ---- the firm's own vocabularies, and who is asking ---------------------------------------------
  //
  // Three session-stable reads, each warmed from this route's +page.ts so they usually resolve out
  // of the cache before this component mounts. A vocabulary that cannot be read leaves its column
  // empty rather than failing the screen: `data` is simply undefined and the fallbacks carry it.

  const sessionRead = createQuery(() => ({ ...meGetOptions(), staleTime: SESSION_STABLE }));
  const matterTypesRead = createQuery(() => ({
    ...matterTypesListOptions(),
    staleTime: SESSION_STABLE,
  }));
  const locationsRead = createQuery(() => ({ ...locationsListOptions(), staleTime: SESSION_STABLE }));

  const session = $derived(sessionRead.data ?? null);
  const matterTypes = $derived(matterTypesRead.data?.data ?? []);
  const locations = $derived(locationsRead.data?.data ?? []);
  const vocabulary = $derived(
    matterTypes.length === 0 && locations.length === 0
      ? EMPTY_TEMPLATE_VOCABULARY
      : templateVocabulary(matterTypes, locations),
  );

  const mayManage = $derived(session?.permissions.includes(MANAGE_TEMPLATES_PERMISSION) ?? false);
  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayManage) return permissionRefusal("Registering a template", MANAGE_TEMPLATES_PERMISSION);
    return undefined;
  });

  // ---- the register, and the windows over it ----------------------------------------------------

  let grid = $state<DataTable.DataTableGridState<TemplateSummary> | null>(null);
  let dialogOpen = $state(false);

  /*
   * The search is the listing's own server-side `search`, applied once typing pauses. It sits
   * beside the create control in the masthead, the pair every list screen carries in the same
   * order, and the clear control undoes it together with the column filters.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  const narrowed = $derived(appliedSearch.trim() !== "" || (grid?.activeFilterCount ?? 0) > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show every template"
      : `Showing "${appliedSearch.trim()}" of the catalogue`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid?.clearAllFilters();
  }
  let windowOpen = $state(false);
  let openTemplate = $state<TemplateSummary | null>(null);
  let addOpen = $state(false);
  let addSubject = $state<{ template: TemplateSummary; kind: TemplateKind | null } | null>(null);

  /*
   * A registration or an archive changes the catalogue behind this screen, so the listing is read
   * again. The plain list key is a prefix of every templates-list key the cache holds — the active
   * and the archived infinite listings both — so one invalidation reaches both pages and any other
   * surface holding the same question, where a screen-local re-read would have left them stale.
   */
  function rereadCatalogue(): void {
    void queryClient.invalidateQueries({ queryKey: templatesListQueryKey() });
  }

  function open(template: TemplateSummary): void {
    openTemplate = template;
    windowOpen = true;
  }

  function addToMatters(template: TemplateSummary, kind: TemplateKind | null): void {
    addSubject = { template, kind };
    addOpen = true;
  }

  function onArchived(): void {
    rereadCatalogue();
    windowOpen = false;
  }
</script>

<svelte:head><title>Documents · Magna Carta</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Documents">
    {#snippet actions()}
      <!-- The search, then the create control, then the way out of a narrowing: the same trio, in
           the same order, as the custody register. The search grows toward the inline start, so
           the control at the row's end never moves when it opens. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the catalogue"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <CreateControl
        noun="Template"
        title="Register a Word document or a fillable PDF as a template."
        refusal={createRefusal}
        onpress={() => (dialogOpen = true)}
      />

      <DataTable.ClearFilters
        grid={grid ?? undefined}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />
    {/snippet}
  </ScreenHeader>

  <!-- One table, the full width of the screen, holding the height it would hold when full. -->
  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    <TemplateRegister
      {vocabulary}
      search={appliedSearch}
      bind:grid
      caption="The firm's document templates"
      onOpenTemplate={open}
    />
  </div>
</div>

<NewTemplateDialog bind:open={dialogOpen} {matterTypes} {locations} onRegistered={rereadCatalogue} />

<TemplateWindow
  bind:open={windowOpen}
  template={openTemplate}
  {vocabulary}
  {mayManage}
  onAddToMatters={addToMatters}
  {onArchived}
/>

<AddToMattersDialog
  bind:open={addOpen}
  template={addSubject?.template ?? null}
  kind={addSubject?.kind ?? null}
/>
