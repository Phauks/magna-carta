<script lang="ts">
  /*
   * THE STANDARD SETTINGS PAGE — one component, everything data-driven, in the three-story
   * anatomy (header = information, middle = the settings, bottom = the exit). It renders the
   * pinned information masthead, the one scroll region, the page's descriptor, the plates its
   * definitions declare (grouped by plateLabel, in declared order), a row per definition bound to
   * ONE page draft, and — for a member who may edit — the commit footer pinned at the column's
   * bottom. A member without the edit right reads every value engraved as a fact, with the per-row
   * change-request affordance and its pre-scoped composer mounted here.
   *
   * THE DRAFT IS SERVER-BACKED. A firm setting with a server behind it must not keep a per-browser
   * copy that can disagree with the firm, so the draft a page hands in reads and writes the
   * server (server-backed-draft.svelte.ts, or a draft of the same shape) and stages nothing into
   * local storage. What this component asks of it is the shape the rows and the footer already
   * understand, plus the four facts a server read adds: whether it has landed, whether it failed,
   * whether the save failed, and how to try either again.
   *
   * THE MODULARITY CONTRACT:
   * - ADD a setting to an existing page = ONE definition in the page's draft module (id, plate,
   *   label, description, kind, default) and its field mapping. The plates, the rows, the pending
   *   count, the recap and the save all derive from that list.
   * - ADD a standard settings page = one section in settings-sections.ts, a draft module declaring
   *   its definitions and its read/write, and a route file that renders
   *   <SettingsPage sectionId="…" title="…" meta="…" {draft} {definitions} {canEdit} … /> under
   *   its <svelte:head> title.
   * - A page with ONE bespoke need composes this and passes a snippet: `afterRow` for content that
   *   belongs beneath one row (a reading the row's choice governs), `plateEnd` for a line that
   *   closes a plate (a fact the rows above it need stated once), `after` for plates of its own
   *   beneath the settings (what the page reads and nothing here changes). A page whose need is larger
   *   composes the same parts this does — settings-masthead, settings-scroll-region,
   *   settings-plate, settings-row, settings-commit-footer — never a second implementation of
   *   the pinning, the rules, or the row grid.
   *
   * WHILE THE READ IS OUT the rows keep their own shape: every plate is a loading region over the
   * same rows at their defaults, so a plate never changes height when the answer lands. A read
   * that fails settles to the notice with Retry, inside the plate it would have filled.
   */
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import type { Snippet } from "svelte";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import RequestChangeDialog from "$lib/settings/components/request-change-dialog.svelte";
  import SettingsCommitFooter from "$lib/settings/components/settings-commit-footer.svelte";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import {
    platesForDefinitions,
    type SettingDefinition,
  } from "$lib/settings/settings-definitions.ts";
  import type { SettingsDraft } from "$lib/settings/settings-draft.svelte.ts";

  /**
   * What a page's draft has to answer beyond the staging shape every row understands: the four
   * facts of a server read. Structural, so a draft built on the shared server-backed base and one
   * written to the same contract by hand both qualify.
   */
  export interface ServerBackedPageDraft extends SettingsDraft {
    readonly loaded: boolean;
    readonly readFailure: Failure | null;
    readonly saveFailure: Failure | null;
    load(): Promise<void>;
    commit(): Promise<void>;
  }

  let {
    sectionId,
    title,
    meta,
    draft,
    definitions,
    canEdit,
    readLabel,
    readFailureTitle,
    readFailureFallback,
    saveFailureFallback,
    saveFailureWhenSilent,
    editable = () => canEdit,
    preview = false,
    notice,
    afterRow,
    plateEnd,
    after,
  }: {
    sectionId: string;
    /** The page title (Title Case, like every setting name). */
    title: string;
    /**
     * The one-line descriptor of what this page governs — the page's voice, not registry data.
     * It leads the page's CONTENT, not the header band (settings-description.svelte).
     */
    meta: string;
    /** The one draft every row on the page stages into and the footer commits. */
    draft: ServerBackedPageDraft;
    /** Every definition the page renders, in reading order; plates follow their plateLabel. */
    definitions: readonly SettingDefinition[];
    /** Whether this member holds the page's edit right. Read-only until the session says so. */
    canEdit: boolean;
    /** The sentence assistive technology hears while the read is out, in the house voice. */
    readLabel: string;
    /** The notice's heading when the read fails ("The Scan Policy Could Not Be Read"). */
    readFailureTitle: string;
    /** The notice's own words when the server sent none. */
    readFailureFallback: string;
    /** The save notice's own words when the server sent none. */
    saveFailureFallback: string;
    /** The save notice's words when nothing answered at all. */
    saveFailureWhenSilent: string;
    /**
     * Whether ONE row takes its control, for a page that has to state a value its control could
     * not express (a billing increment outside the offered list). Defaults to the page's edit
     * right; a row this declines is engraved instead of controlled.
     */
    editable?: (definition: SettingDefinition) => boolean;
    /** Demonstration pages: settings not yet in effect (the masthead's Preview badge). */
    preview?: boolean;
    /** Page-level content between the descriptor and the plates (a notice the page owns). */
    notice?: Snippet;
    /** Content that belongs beneath one row, inside the plate's rule rhythm. */
    afterRow?: Snippet<[SettingDefinition]>;
    /**
     * A closing line for one plate, by its label — a fact its rows need stated once, rendered
     * through settings-plate-note.svelte so it takes the plate's own rhythm. The snippet decides
     * which plates get one; for the rest it renders nothing.
     */
    plateEnd?: Snippet<[string]>;
    /**
     * Plates of the page's own, beneath the settings and inside the same scroll region: facts the
     * page reads and no row here changes (how a setting above is working out). They are built
     * from settings-plate and settings-row like everything above them, and they stage nothing,
     * so the commit footer never counts them.
     */
    after?: Snippet;
  } = $props();

  const plates = $derived(platesForDefinitions(definitions));
  const posture = $derived<"draft" | "readOnly">(canEdit ? "draft" : "readOnly");

  $effect(() => {
    void draft.load();
  });

  let requestOpen = $state(false);
  let requestDefinition = $state<SettingDefinition | null>(null);

  function openRequest(definition: SettingDefinition): void {
    requestDefinition = definition;
    requestOpen = true;
  }
</script>

<!-- The three-story page: header = information, middle = the settings, bottom = the exit
     (the commit footer, editable pages only). -->
<SettingsMasthead
  {sectionId}
  {title}
  {posture}
  draft={canEdit ? draft : undefined}
  {preview}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>{meta}</SettingsDescription>

  {#if notice !== undefined}
    {@render notice()}
  {/if}

  {#if draft.saveFailure !== null}
    <FailureNotice
      failure={draft.saveFailure}
      title="The Change Was Not Saved"
      fallback={saveFailureFallback}
      whenSilent={saveFailureWhenSilent}
      onRetry={() => void draft.commit()}
    />
  {/if}

  {#each plates as plate (plate.label)}
    <SettingsPlate heading={plate.label}>
      <LoadingRegion
        loading={!draft.loaded}
        failed={draft.readFailure !== null && !draft.loaded}
        label={readLabel}
        onRetry={() => void draft.load()}
        class="flex flex-col divide-y divide-border-default"
      >
        {#snippet failure()}
          {#if draft.readFailure !== null}
            <FailureNotice
              failure={draft.readFailure}
              title={readFailureTitle}
              fallback={readFailureFallback}
              onRetry={() => void draft.load()}
            />
          {/if}
        {/snippet}
        <!-- The rows keep their own shape while the read is out: the setting's name stays
             readable and its value grey, so the plate does not change height when it lands. -->
        {#snippet fixture()}
          {#each plate.definitions as definition (definition.id)}
            <SettingsRow {definition} value={definition.defaultValue} />
          {/each}
        {/snippet}
        {#each plate.definitions as definition (definition.id)}
          {#if editable(definition)}
            <SettingsRow {definition} {draft} />
          {:else if canEdit}
            <SettingsRow {definition} value={draft.value(definition)} />
          {:else}
            <SettingsRow
              {definition}
              value={draft.value(definition)}
              onRequestChange={openRequest}
            />
          {/if}
          {#if afterRow !== undefined}
            {@render afterRow(definition)}
          {/if}
        {/each}
        {#if plateEnd !== undefined}
          {@render plateEnd(plate.label)}
        {/if}
      </LoadingRegion>
    </SettingsPlate>
  {/each}

  {#if after !== undefined}
    {@render after()}
  {/if}
</SettingsScrollRegion>

{#if canEdit}
  <SettingsCommitFooter {draft} />
{/if}

{#if requestDefinition !== null}
  <RequestChangeDialog bind:open={requestOpen} definition={requestDefinition} />
{/if}
