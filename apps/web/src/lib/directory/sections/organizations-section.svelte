<script lang="ts">
  /*
   * The organizations a person belongs to, and how: employer, the firm they are a partner of,
   * the board they sit on. One line each — the organization's mark and name, the relationship
   * and the role beside it — and an add row that picks the organization from the directory, the
   * kind of relationship from the membership catalog, and an optional role. The edge's direction
   * is the type's (edge-draft.ts), never the reader's to get wrong.
   */
  import Button from "@magna-carta/design-system/button";
  import EntityIdentity from "@magna-carta/design-system/entity-identity";
  import type { EntitySearch, PickableEntity } from "@magna-carta/design-system/entity-picker";
  import DirectoryEntityPicker from "../directory-entity-picker.svelte";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import Unlink from "@lucide/svelte/icons/unlink";
  import type { DirectoryEdgeType } from "../directory-api.ts";
  import { edgeTypeLabel } from "../directory-vocabulary.ts";
  import { farKindsFor, offeredEdgeTypesForRecord } from "../edge-draft.ts";
  import type { OrganizationDraft } from "../person-draft.ts";

  let {
    rows,
    search,
    disabled = false,
    onAdd,
    onRemove,
  }: {
    rows: readonly OrganizationDraft[];
    search: EntitySearch;
    disabled?: boolean;
    onAdd: (draft: Omit<OrganizationDraft, "id">) => void;
    onRemove: (draft: OrganizationDraft) => void;
  } = $props();

  const identity = $props.id();
  const relationshipLabelId = `${identity}-relationship`;
  const organizationInputId = `${identity}-organization`;

  // The relationships a person can have with an organization, from the one catalog.
  const relationshipItems = offeredEdgeTypesForRecord("person")
    .filter((entry) => farKindsFor("person", entry).includes("organization"))
    .map((entry) => ({ value: entry.edgeType, label: entry.label }));

  let picked = $state<PickableEntity | null>(null);
  let edgeType = $state<DirectoryEdgeType>("employment");
  let role = $state("");

  const excluded = $derived(rows.map((row) => row.organizationId));

  function add(): void {
    if (picked === null || disabled) return;
    onAdd({
      organizationId: picked.identifier,
      organizationName: picked.name,
      edgeType,
      role: role.trim(),
    });
    picked = null;
    role = "";
    adding = false;
  }

  /**
   * Whether the entry row is open. It starts closed, as an Add to Organization button, and closes
   * again once the link is added (owner ruling 2026-11-13: "just make an add ... button, at which point the fields would populate. this reduces clutter").
   */
  let adding = $state(false);
</script>

<section class="flex flex-col gap-12">
  {#if rows.length > 0}
    <ul class="flex flex-col">
      {#each rows as row (row.id)}
        <li class="flex items-center gap-8 border-b border-border-default py-4">
          <div class="min-w-0 flex-auto">
            <EntityIdentity
              kind="organization"
              name={row.organizationName}
              size="default"
              aside={[edgeTypeLabel(row.edgeType), row.role === "" ? null : row.role]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            {disabled}
            title="Unlink"
            aria-label="Unlink {row.organizationName}"
            onclick={() => onRemove(row)}
          >
            <Unlink class="size-16" aria-hidden="true" />
          </Button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !adding}
    <div>
      <Button variant="secondary" size="sm" {disabled} onclick={() => (adding = true)}>
        <Plus class="size-16" aria-hidden="true" />
        Add to Organization
      </Button>
    </div>
  {:else}
  <div class="grid items-end gap-8" style="grid-template-columns: minmax(0, 1.4fr) 10rem minmax(0, 1fr) auto auto">
    <div class="flex flex-col gap-8">
      <Label for={organizationInputId}>Organization</Label>
      <DirectoryEntityPicker
        {search}
        kinds={["organization"]}
        {excluded}
        bind:value={picked}
        label="Organization"
        inputId={organizationInputId}
        {disabled}
      />
    </div>
    <div class="flex flex-col gap-8">
      <Label id={relationshipLabelId}>Relationship</Label>
      <Select.Root
        type="single"
        items={relationshipItems}
        bind:value={() => edgeType, (chosen) => (edgeType = chosen as DirectoryEdgeType)}
        allowDeselect={false}
        {disabled}
      >
        <Select.Trigger aria-labelledby={relationshipLabelId}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {#each relationshipItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <LabelledField label="Role">
      {#snippet children({ props })}
        <Input {...props} bind:value={role} {disabled} placeholder={placeholderOf("Role")} />
      {/snippet}
    </LabelledField>
    <Button
      variant="secondary"
      size="icon"
      disabled={disabled || picked === null}
      title={picked === null ? "Choose an organization" : "Add"}
      aria-label="Add this organization"
      onclick={add}
    >
      <Plus class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title="Cancel"
      aria-label="Cancel adding an organization"
      onclick={() => {
        adding = false;
        picked = null;
        role = "";
      }}
    >
      <X class="size-16" aria-hidden="true" />
    </Button>
  </div>
  {/if}
</section>
