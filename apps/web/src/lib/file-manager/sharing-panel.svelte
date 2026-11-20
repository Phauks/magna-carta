<script lang="ts">
  /*
   * SHARING, IN THE RIGHT-HAND PANE: who outside the firm can see the selected file or folder, and
   * what each person can do. People who have it directly get a role menu and a "..." menu (download,
   * end date, stop); people who have it through its folder are listed under the folder's name, read
   * only here, because changing them changes everything else in that folder too.
   *
   * Adding a person shares this item with them as a Viewer; the role is changed in place after. A
   * person is picked from the Directory, never typed as an address: every share names a record the
   * firm can run a conflict check against.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as Select from "@magna-carta/design-system/select";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import EntityPicker, {
    type EntitySearch,
    type PickableEntity,
  } from "@magna-carta/design-system/entity-picker";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Folder from "@lucide/svelte/icons/folder";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import Users from "@lucide/svelte/icons/users";
  import type { ShareRole, ShareSummary } from "./sharing-api.ts";
  import { ROLE_DESCRIPTIONS, ROLE_LABELS, roleItems, type SharedPerson } from "./sharing-index.ts";

  let {
    people,
    inheritedFrom,
    search,
    shareRefusal,
    busy = false,
    selectionCount = 1,
    adding = $bindable(false),
    onAdd,
    onChange,
    onStop,
  }: {
    /** Everyone who can see the item, from the sharing index. */
    people: readonly SharedPerson[];
    /** The name of the place shares reach this item through: a folder's name, or "the matter's top level". */
    inheritedFrom: string | null;
    /** The Directory, as the picker searches it. */
    search: EntitySearch;
    /** Why this member cannot share, when they cannot. The list still shows; the controls do not act. */
    shareRefusal?: string;
    busy?: boolean;
    /** How many selected items an added person is shared with. The list below is the last one's. */
    selectionCount?: number;
    /** Whether the Directory search is showing; the file menu's Share opens the panel with it. */
    adding?: boolean;
    onAdd: (person: PickableEntity) => void;
    onChange: (share: ShareSummary, changes: { role?: ShareRole; allowDownload?: boolean; endsOn?: string | null }) => void;
    onStop: (share: ShareSummary) => void;
  } = $props();

  let picked = $state<PickableEntity | null>(null);
  // Which share's end date is being set, by id. An end date is optional, so it starts as a menu item.
  let datingShareId = $state<string | null>(null);

  const direct = $derived(people.filter((person) => person.direct !== null));
  const throughFolder = $derived(people.filter((person) => person.direct === null));
  const excluded = $derived(people.map((person) => person.entityId));

  function pick(person: PickableEntity): void {
    adding = false;
    picked = null;
    onAdd(person);
  }

  function dormantWords(share: ShareSummary): string | null {
    if (share.dormant === "ended") return "Ended";
    if (share.dormant === "needsNewSharer") return "Needs a new sharer";
    return null;
  }
</script>

<section class="flex flex-col gap-12 p-12" aria-label="Sharing">
  <div class="flex items-center gap-8">
    <h3 class="text-sm font-medium">People With Access</h3>
    <Button
      variant="secondary"
      size="sm"
      class="ms-auto"
      disabled={busy || shareRefusal !== undefined}
      title={shareRefusal ?? "Add Person"}
      onclick={() => (adding = !adding)}
    >
      <UserPlus class="size-16" aria-hidden="true" />
      Add Person
    </Button>
  </div>

  {#if selectionCount > 1}
    <p class="text-xs text-text-muted">
      A person added here gets all {selectionCount} selected items. The list below is for the last one
      selected.
    </p>
  {/if}

  {#if adding}
    <EntityPicker
      {search}
      kinds={["person"]}
      {excluded}
      label="Add a person from the Directory"
      bind:value={picked}
      onSelect={pick}
    />
  {/if}

  {#if people.length === 0}
    <p class="text-sm text-text-muted">Only the firm can see this.</p>
  {/if}

  {#if direct.length > 0}
    <ul class="flex flex-col">
      {#each direct as person (person.entityId)}
        {@const share = person.direct!}
        {@const dormant = dormantWords(share)}
        {@const items = roleItems(share.role)}
        <li class="flex flex-col gap-8 border-b border-border-default py-8 last:border-b-0">
          <div class="flex items-center gap-8">
            <Avatar.Root class="size-32 shrink-0 bg-status-info-subtle">
              <Avatar.Fallback class="text-xs text-status-info-subtle-foreground">{person.initials}</Avatar.Fallback>
            </Avatar.Root>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium">{person.name}</span>
              <span class="truncate text-xs text-text-muted">
                {#if dormant !== null}
                  <Badge variant="warning">{dormant}</Badge>
                {:else}
                  {[
                    share.allowDownload ? null : "No download",
                    share.endsOn === null ? null : `Until ${formatDate(share.endsOn)}`,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                {/if}
              </span>
            </div>
            <div class="w-96 shrink-0">
              <Select.Root
                type="single"
                {items}
                allowDeselect={false}
                disabled={busy || shareRefusal !== undefined}
                value={share.role}
                onValueChange={(next) => onChange(share, { role: next as ShareRole })}
              >
                <Select.Trigger aria-label="Role for {person.name}">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {#each items as option (option.value)}
                    <Select.Item value={option.value} label={option.label}>
                      <span class="flex flex-col">
                        <span>{option.label}</span>
                        <span class="text-xs text-text-muted">{ROLE_DESCRIPTIONS[option.value]}</span>
                      </span>
                    </Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <DropdownMenu.Root openOnHover={false}>
              <DropdownMenu.Trigger
                class={buttonClasses({ variant: "ghost", size: "icon" })}
                aria-label="More for {person.name}"
                disabled={busy || shareRefusal !== undefined}
              >
                <Ellipsis class="size-16" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.CheckboxItem
                  checked={share.allowDownload}
                  onCheckedChange={(checked) => onChange(share, { allowDownload: checked })}
                >
                  Allow Download
                </DropdownMenu.CheckboxItem>
                {#if share.endsOn === null}
                  <DropdownMenu.Item onSelect={() => (datingShareId = share.id)}>Add End Date</DropdownMenu.Item>
                {:else}
                  <DropdownMenu.Item onSelect={() => (datingShareId = share.id)}>Change End Date</DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => onChange(share, { endsOn: null })}>Remove End Date</DropdownMenu.Item>
                {/if}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => onStop(share)}>Stop Sharing</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
          {#if datingShareId === share.id}
            <DatePicker
              necessity="optional"
              label="End Date"
              size="sm"
              value={civilDateValue(share.endsOn)}
              onValueChange={(next) => {
                const text = civilDateTextOrEmpty(next);
                if (text === "") return;
                datingShareId = null;
                onChange(share, { endsOn: text });
              }}
            />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if throughFolder.length > 0 && inheritedFrom !== null}
    <div class="flex flex-col gap-4">
      <p class="flex items-center gap-8 text-xs text-text-muted">
        <Folder class="size-16" aria-hidden="true" />
        Through {inheritedFrom}
      </p>
      <ul class="flex flex-col">
        {#each throughFolder as person (person.entityId)}
          <li class="flex items-center gap-8 py-8">
            <Avatar.Root class="size-32 shrink-0 bg-status-info-subtle">
              <Avatar.Fallback class="text-xs text-status-info-subtle-foreground">{person.initials}</Avatar.Fallback>
            </Avatar.Root>
            <span class="min-w-0 flex-1 truncate text-sm">{person.name}</span>
            <span class="text-sm text-text-muted">{ROLE_LABELS[person.role]}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if people.length > 0}
    <p class="flex items-center gap-8 text-xs text-text-muted">
      <Users class="size-16" aria-hidden="true" />
      {people.length === 1 ? "1 person" : `${people.length} people`} outside the firm can see this.
    </p>
  {/if}
</section>
