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
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import Plus from "@lucide/svelte/icons/plus";
  import {
    assignDirectoryCategory,
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

  let carried = $state<readonly DirectoryCategory[] | null>(null);
  let vocabulary = $state<readonly DirectoryCategory[]>([]);
  let failure = $state<string | null>(null);
  let reloadToken = $state(0);

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    carried = null;
    failure = null;
    void (async () => {
      const [assigned, all] = await Promise.all([
        readDirectoryEntityCategories(fetch, id),
        readDirectoryCategories(fetch),
      ]);
      if (cancelled) return;
      if (all.kind === "ok") vocabulary = all.value.data;
      if (assigned.kind === "ok") {
        carried = assigned.value.data;
        return;
      }
      carried = [];
      failure =
        assigned.kind === "transport"
          ? "Nothing answered. This record's categories could not be read."
          : (assigned.problem.detail ?? "This record's categories could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

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
  const categoryItems = $derived(
    assignable.map((category) => ({ value: category.id, label: category.name })),
  );

  let open = $state(false);
  let chosen = $state<string>("");
  let submitting = $state(false);
  let assignFailure = $state<string | null>(null);

  async function submit(): Promise<void> {
    if (chosen === "" || submitting) return;
    submitting = true;
    assignFailure = null;
    const outcome = await assignDirectoryCategory(
      fetch,
      { entityId, categoryId: chosen },
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      chosen = "";
      open = false;
      reloadToken += 1;
      return;
    }
    assignFailure =
      outcome.kind === "transport"
        ? "Nothing answered. The category was not assigned."
        : (outcome.problem.detail ?? "The category could not be assigned.");
  }
</script>

<section class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16">
    <h3 class="text-sm font-semibold">Categories</h3>
    <Button
      variant="secondary"
      disabled={!mayEdit || categoryItems.length === 0}
      title={categoryItems.length === 0
        ? "The firm has no category left that fits this record."
        : editDisabledReason}
      onclick={() => {
        assignFailure = null;
        chosen = "";
        open = true;
      }}
    >
      <Plus class="size-16" aria-hidden="true" />
      Assign a category
    </Button>
  </div>

  {#if failure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>The Categories Could Not Be Read</Alert.Title>
      <Alert.Description>{failure}</Alert.Description>
    </Alert.Root>
  {:else if carried === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading this record's categories">
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if carried.length === 0}
    <EmptyState title="Filed Under Nothing">
      The firm has not filed this record under any of its own categories. Categories are the firm's
      words for the kinds of people and organizations it deals with, and a record without one is
      simply unlabelled.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">How the firm files this record</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Category</DataTable.Head>
          <DataTable.Head>Applies to</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each carried as category (category.id)}
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
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
</section>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg">
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Dialog.Title>Assign A Category</Dialog.Title>
        <Dialog.Description>
          Only the firm's own categories that fit this side of the directory are offered.
        </Dialog.Description>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="assign-category-label">Category</Label>
        <Select.Root type="single" items={categoryItems} bind:value={chosen} allowDeselect={false}>
          <Select.Trigger class="min-w-64" aria-labelledby="assign-category-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each categoryItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      {#if assignFailure !== null}
        <Alert.Root variant="danger">
          <Alert.Description>{assignFailure}</Alert.Description>
        </Alert.Root>
      {/if}

      <div class="flex justify-end gap-8">
        <Dialog.Close
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={submitting}
        >
          Cancel
        </Dialog.Close>
        <Button variant="primary" disabled={chosen === "" || submitting} onclick={submit}>
          {submitting ? "Assigning" : "Assign Category"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
