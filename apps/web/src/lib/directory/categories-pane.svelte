<script lang="ts">
  /*
   * How the firm files this record.
   *
   * A category is the firm's own word for a kind of person or organization it deals with — expert
   * witness, process server, opposing counsel, insurer. The vocabulary is the firm's, not the
   * platform's: nothing here ships a list of labels, and nothing infers one from what a record has
   * been a party to.
   *
   * A label's applies-to is enforced by the record rather than by the picker's good manners — the
   * server refuses a person-only label on an organization — but the picker still offers only what
   * fits, because an option that cannot be chosen is a worse answer than an option that is absent.
   *
   * A RETIRED LABEL STILL SHOWS. A firm that stopped using a word did not stop having filed people
   * under it, and a record that silently dropped the label would be telling a reader the filing
   * never happened.
   *
   * A WORD THE FIRM HAS NOT NAMED YET IS NAMED FROM HERE. The moment somebody needs a category the
   * firm does not have is the moment they are filing a record under it, and sending them to a
   * settings screen loses the record they were on. So the picker is the product's one dropdown
   * with its add row: a typed name that matches nothing becomes the firm's category, made for this
   * side of the directory, and the record is filed under it in the same commit. The creation and
   * the assignment are two writes, and a retry after the first has landed must not make the word
   * twice — so once the category exists it is held as the chosen one and only the filing is
   * retried.
   *
   * THE ASSIGN PANEL IS THE ACTION DIALOG SHELL; this file holds the field and the commit only.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Combobox from "@magna-carta/design-system/combobox";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Plus from "@lucide/svelte/icons/plus";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    assignDirectoryCategory,
    createDirectoryCategory,
    readDirectoryCategories,
    readDirectoryEntityCategories,
    type DirectoryCategory,
    type DirectoryEntityKind,
  } from "./directory-api.ts";

  let {
    entityId,
    kind,
    mayEdit,
    editDisabledReason,
  }: {
    entityId: string;
    kind: DirectoryEntityKind;
    mayEdit: boolean;
    editDisabledReason?: string;
  } = $props();

  /** The field's own name, which is also its ghost text and the add row's subject. */
  const FIELD_NAME = "Category";

  let carried = $state<readonly DirectoryCategory[] | null>(null);
  let vocabulary = $state<readonly DirectoryCategory[]>([]);
  let readFailure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);
  /** True while a list already on screen is being read again, after a category was assigned. */
  let refreshing = $state(false);
  // The record whose categories last landed. Only a change of RECORD discards what is on screen:
  // a re-read after an assignment keeps the rows where the reader is looking and marks the region
  // busy instead.
  let shownFor: string | null = null;

  /**
   * The shape the list takes while the record's categories are being read: the same rows the real
   * list renders, over sample words of a plausible length. Not any firm's vocabulary.
   */
  const CATEGORY_FIXTURE: readonly DirectoryCategory[] = [
    { id: "fixture-1", name: "Expert witness", appliesTo: "person", position: 0, archived: false },
    { id: "fixture-2", name: "Opposing counsel", appliesTo: "both", position: 1, archived: false },
  ];

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    if (shownFor === id) {
      refreshing = true;
    } else {
      carried = null;
    }
    readFailure = null;
    void (async () => {
      const [assigned, all] = await Promise.all([
        readDirectoryEntityCategories(fetch, id),
        readDirectoryCategories(fetch),
      ]);
      if (cancelled) return;
      refreshing = false;
      if (all.kind === "ok") vocabulary = all.value.data;
      if (assigned.kind === "ok") {
        shownFor = id;
        carried = assigned.value.data;
        return;
      }
      shownFor = null;
      carried = [];
      readFailure = stated(assigned.failure, "Couldn't load this record's categories.");
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function retry(): void {
    reloadToken += 1;
  }

  // Only labels that fit this side of the directory, and only ones the record does not already
  // carry — the composite key means assigning a label twice is a refusal, not a second row.
  const assignable = $derived(
    vocabulary.filter(
      (category) =>
        !category.archived &&
        (category.appliesTo === "both" || category.appliesTo === kind) &&
        !(carried ?? []).some((entry) => entry.id === category.id),
    ),
  );

  // ---- the assign panel --------------------------------------------------------------------------

  let open = $state(false);
  let assignFailure = $state<StatedFailure | null>(null);

  /** What is typed in the field. The consumer owns it, in the documented data-safe shape. */
  let query = $state("");
  /** The firm's category the record will be filed under, once one is chosen or made. */
  let chosenId = $state<string | null>(null);
  /** A name typed for a category the firm has not named yet, held until the commit makes it. */
  let newName = $state<string | null>(null);

  /** Narrowed by what has been typed. An empty query offers everything that fits. */
  const matching = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return assignable;
    return assignable.filter((category) => category.name.toLowerCase().includes(needle));
  });

  /**
   * Every row the listbox holds, which is also what the primitive needs told: bits reads this list
   * to name the selection once the rows themselves are unmounted.
   */
  const items = $derived(matching.map((category) => ({ value: category.id, label: category.name })));

  /** What the field reads at rest: the chosen category's name, the name to be made, or nothing. */
  const settledText = $derived(
    newName ?? (chosenId === null ? "" : (vocabulary.find((c) => c.id === chosenId)?.name ?? "")),
  );

  /*
   * Why the commit is unavailable, or undefined when it is available. The shell shows this beside
   * the control it refuses, so a reader who typed a word and never picked the add row is told
   * that nothing is chosen yet rather than shown a dead control.
   */
  const refusal = $derived(
    chosenId === null && newName === null ? "Choose a category, or type one to add." : undefined,
  );

  /** Whether anything has been chosen or typed. A blank field has nothing to lose. */
  const started = $derived(chosenId !== null || newName !== null || query.trim() !== "");

  function pick(picked: string | string[]): void {
    const chosen = Array.isArray(picked) ? (picked[0] ?? "") : picked;
    if (chosen === "") {
      chosenId = null;
      newName = null;
      query = "";
      return;
    }
    if (Combobox.isAddOption(chosen)) {
      const typed = query.trim();
      if (typed === "") return;
      // A typed name that IS one of the firm's categories, spelled differently in case, files the
      // record under that one rather than minting a second word that reads the same beside it.
      const existing = assignable.find(
        (category) => category.name.toLowerCase() === typed.toLowerCase(),
      );
      if (existing !== undefined) {
        chosenId = existing.id;
        newName = null;
        query = existing.name;
        return;
      }
      chosenId = null;
      newName = typed;
      query = typed;
      return;
    }
    chosenId = chosen;
    newName = null;
    query = vocabulary.find((category) => category.id === chosen)?.name ?? "";
  }

  function reset(): void {
    assignFailure = null;
    query = "";
    chosenId = null;
    newName = null;
  }

  async function submit(): Promise<ActionOutcome> {
    assignFailure = null;
    if (newName !== null) {
      const made = await createDirectoryCategory(
        fetch,
        { name: newName, appliesTo: kind },
        crypto.randomUUID(),
      );
      if (made.kind !== "ok") {
        assignFailure = stated(
          made.failure,
          "Couldn't add the category.",
          "The category wasn't added, and the record wasn't saved.",
        );
        return "refused";
      }
      // The word exists now. It joins what this pane knows so the field can name it, and it
      // becomes the chosen one so a retry files the record under it rather than making it twice.
      const created: DirectoryCategory = {
        id: made.value.id,
        name: newName,
        appliesTo: kind,
        position: vocabulary.length,
        archived: false,
      };
      vocabulary = [...vocabulary, created];
      chosenId = created.id;
      newName = null;
    }
    if (chosenId === null) return "refused";
    const outcome = await assignDirectoryCategory(
      fetch,
      { entityId, categoryId: chosenId },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      reloadToken += 1;
      return "committed";
    }
    assignFailure = stated(
      outcome.failure,
      "Couldn't assign the category.",
      "The category wasn't assigned.",
    );
    return "refused";
  }
</script>

<section class="flex flex-col gap-16">
  <!-- The section's heading is the record's own (record-sections.svelte); its acts stand here. -->
  <div class="flex items-center justify-end gap-16">
    <Button
      variant="secondary"
      disabled={!mayEdit}
      title={editDisabledReason}
      aria-label={mayEdit ? undefined : `Assign a category: ${editDisabledReason ?? ""}`}
      onclick={() => {
        open = true;
      }}
    >
      <Plus class="size-16" aria-hidden="true" />
      Assign a category
    </Button>
  </div>

  <LoadingRegion
    loading={carried === null}
    {refreshing}
    failed={readFailure !== null}
    label="Reading this record's categories"
    onRetry={retry}
    class="flex flex-col gap-8"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="Couldn't Load Categories"
          fallback={readFailure.fallback}
          whenSilent={readFailure.whenSilent}
          onRetry={retry}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render categoryTable(CATEGORY_FIXTURE)}
    {/snippet}
    {@render categoryTable(carried ?? [])}
  </LoadingRegion>
</section>

<!-- One table for the rows, for the shape they take while they are read, and for the empty body
     they leave behind when there are none, so the three cannot drift. -->
{#snippet categoryTable(rows: readonly DirectoryCategory[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">How the firm files this record</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Category</DataTable.Head>
        <DataTable.Head>Applies to</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as category (category.id)}
        <DataTable.Row>
          <DataTable.Cell>
            <span class="flex flex-wrap items-center gap-8">
              {category.name}
              {#if category.archived}
                <Badge variant="neutral">Retired</Badge>
              {/if}
            </span>
          </DataTable.Cell>
          <DataTable.Cell>
            <span class="text-text-muted">
              {category.appliesTo === "both" ? "People and organizations" : category.appliesTo}
            </span>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow columns={2} title="Filed Under Nothing" />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

<ActionDialog
  bind:open
  kind="form"
  heading="Assign a Category"
  commitLabel="Assign"
  commitBusyLabel="Assigning"
  commitRefusal={refusal}
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if assignFailure !== null}
      <FailureNotice
        failure={assignFailure.failure}
        title="Category Not Assigned"
        fallback={assignFailure.fallback}
        whenSilent={assignFailure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <LabelledField label={FIELD_NAME}>
      {#snippet children({ props })}
        <Combobox.Root
          type="single"
          disabled={busy}
          {items}
          inputValue={query}
          onValueChange={pick}
          onOpenChange={(listboxOpen) => {
            // Closing settles the text on the truth: the chosen category, the name about to be
            // made, or empty when neither — so typed text nobody chose is never mistaken for one.
            if (!listboxOpen) query = settledText;
          }}
        >
          <Combobox.Input
            {...props}
            fieldName={FIELD_NAME}
            oninput={(event) => (query = event.currentTarget.value)}
          />
          <Combobox.Content>
            {#each matching as category (category.id)}
              <Combobox.Item value={category.id} label={category.name} />
            {/each}
            <Combobox.AddOption fieldName={FIELD_NAME} {query} />
          </Combobox.Content>
        </Combobox.Root>
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
