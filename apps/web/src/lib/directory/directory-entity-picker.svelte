<script lang="ts">
  /*
   * The directory's picker — the design system's EntityPicker, fed the firm's search, and able to
   * RECORD what it cannot find.
   *
   * WHY A WRAPPER EXISTS. Every surface that picks a person or an organization asks the same
   * question of the same record, and until now each of them ended at the same wall: a name the
   * directory did not hold sent the reader to the Directory screen, and the matter, the cost, the
   * conflicts check or the calendar event they were in the middle of lost its place. The owner's
   * direction of 2026-09-05 is that a record can be made from wherever a person is chosen, through a
   * top-level New. The picker itself knows how to offer that; what it cannot know is what recording
   * a person or an organization IS in this product. That is this file: the New Person and New
   * Organization windows the Directory screen already opens, opened here over whatever surface the
   * picker stands in, seeded with what was typed, and their result handed back to the field as its
   * selection.
   *
   * THE RECORD IS MADE THROUGH THE SAME WINDOWS THE DIRECTORY USES. Not a shorter form: a person
   * recorded from a client field is the same person, with the same duplicate gate on the right, as
   * one recorded from the Directory. A lighter window here would be a second place to learn where a
   * person's fields live and a second gate to keep in step with the first.
   *
   * THE PERMISSION IS THE DIRECTORY'S. Recording needs directory:edit; a reader without it sees the
   * New control refused with the reason, and the add row is not offered. The session is read once
   * and shared, because a picker stands in places that have no screen to hand it down from.
   */
  import { onMount } from "svelte";
  import EntityPicker, {
    type EntitySearch,
    type PickableEntity,
  } from "@magna-carta/design-system/entity-picker";
  import type { EntityKind } from "@magna-carta/design-system/entity-identity";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import { DIRECTORY_EDIT_PERMISSION, readDirectoryEntity } from "./directory-api.ts";
  import { directoryPickerSearch } from "./directory-picker-source.ts";
  import { directoryEntityName } from "./entity-presentation.ts";
  import NewOrganizationDialog from "./new-organization-dialog.svelte";
  import NewPersonDialog from "./new-person-dialog.svelte";
  import { personNameFromTyped } from "./typed-name.ts";

  /** The picker's own default, restated because the picker does not export it. */
  const EVERY_KIND: readonly EntityKind[] = ["person", "organization"];

  let {
    search,
    multiple = false,
    value = $bindable(null),
    values = $bindable([]),
    kinds = EVERY_KIND,
    excluded = [],
    minimumQueryLength,
    label = "Person or organization",
    inputId,
    disabled = false,
    disabledReason,
    allowCreate = true,
    createBeside = true,
    onSelect,
    onClear,
    class: className,
  }: {
    /** How the directory is asked. Defaults to the firm's ranked name search over `kinds`. */
    search?: EntitySearch;
    multiple?: boolean;
    value?: PickableEntity | null;
    values?: readonly PickableEntity[];
    kinds?: readonly EntityKind[];
    excluded?: readonly string[];
    minimumQueryLength?: number;
    label?: string;
    inputId?: string;
    disabled?: boolean;
    disabledReason?: string;
    /** Whether the field may record what it cannot find. Off for a field over a closed set. */
    allowCreate?: boolean;
    /** Whether the New control stands beside the field, or only inside its list. */
    createBeside?: boolean;
    onSelect?: (entity: PickableEntity) => void;
    onClear?: () => void;
    class?: string;
  } = $props();

  const directorySearch = $derived(search ?? directoryPickerSearch(fetch, { kinds }));

  onMount(() => {
    if (allowCreate) void sessionPermissions.load(fetch);
  });

  const createRefusal = $derived.by((): string | undefined => {
    if (!allowCreate) return undefined;
    if (!sessionPermissions.settled) return "Checking whether your account may add to the directory.";
    // A read that failed and a permission not held are different facts, and the line says which.
    if (sessionPermissions.failed) return "Couldn't load your session, so nothing can be added.";
    return sessionPermissions.holds(DIRECTORY_EDIT_PERMISSION)
      ? undefined
      : permissionRefusal("Adding to the directory", DIRECTORY_EDIT_PERMISSION);
  });

  let personOpen = $state(false);
  let organizationOpen = $state(false);
  let personPrefill = $state<{ given: string; family: string } | null>(null);
  let organizationPrefill = $state<{ legalName: string } | null>(null);

  function create(typed: string, kind: EntityKind): void {
    if (kind === "person") {
      personPrefill = typed === "" ? null : personNameFromTyped(typed);
      personOpen = true;
    } else {
      organizationPrefill = typed === "" ? null : { legalName: typed };
      organizationOpen = true;
    }
  }

  /**
   * The record exists; the field takes it as its selection. Its name is read back from the
   * directory, so the field shows the name every other surface will show; where that read fails
   * the field takes the name the window recorded instead, because a record that was made and a
   * field left empty would read as a cancellation.
   */
  async function adopt(entityId: string, recordedName: string, kind: EntityKind): Promise<void> {
    const read = await readDirectoryEntity(fetch, entityId);
    const name = read.kind === "ok" ? directoryEntityName(read.value) : recordedName;
    const entity: PickableEntity = { identifier: entityId, name, kind };
    if (multiple) {
      values = [...values, entity];
    } else {
      value = entity;
    }
    onSelect?.(entity);
  }
</script>

<EntityPicker
  search={directorySearch}
  {multiple}
  bind:value
  bind:values
  {kinds}
  {excluded}
  {minimumQueryLength}
  {label}
  {inputId}
  {disabled}
  {disabledReason}
  onCreate={allowCreate ? create : undefined}
  {createRefusal}
  {createBeside}
  {onSelect}
  {onClear}
  class={className}
/>

{#if allowCreate}
  <NewPersonDialog
    bind:open={personOpen}
    prefill={personPrefill}
    onCreated={(entityId, recordedName) => void adopt(entityId, recordedName, "person")}
  />
  <NewOrganizationDialog
    bind:open={organizationOpen}
    prefill={organizationPrefill}
    onCreated={(entityId, recordedName) => void adopt(entityId, recordedName, "organization")}
  />
{/if}
