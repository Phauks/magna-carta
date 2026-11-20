<script lang="ts">
  /*
   * THE SHARING VIEW: everything shared on this matter, reviewed one person at a time over the
   * matter's own folders. Sharing is read against the file structure, because what a folder share
   * reaches depends on where the files sit: a folder share covers the files directly inside it and
   * not its subfolders, and Home (the top level) covers the files in no folder. So the outline here is the
   * matter's folders and files, in the order the rail shows them, and each row says what the person
   * can do with it and why.
   *
   * A row the person has a share on carries a role menu, with No Access to stop it. A row they see
   * through its folder says so and names the folder; it is changed on the folder's row, because that
   * share reaches every file beside it. A row they cannot see offers Share, so sharing more
   * is done where the reader is already looking: Share gives them the row as a Viewer, and the menu
   * that appears changes it. Download and end dates are set from the details panel's Sharing
   * section.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EntityPicker, {
    type EntitySearch,
    type PickableEntity,
  } from "@magna-carta/design-system/entity-picker";
  import FileIcon from "@magna-carta/design-system/file-icon";
  import FolderGlyph from "@magna-carta/design-system/folder-glyph";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import House from "@lucide/svelte/icons/house";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import type { FolderSummary } from "./folder-api.ts";
  import type { MatterFile } from "./matter-file-api.ts";
  import type { MatterFileIndex } from "./file-rows.ts";
  import type { ShareRole, ShareSummary } from "./sharing-api.ts";
  import {
    ROLE_LABELS,
    initialsOf,
    roleItems,
    type SharingIndex,
    type SharingTarget,
  } from "./sharing-index.ts";

  let {
    files,
    sharing,
    search,
    shareRefusal,
    busy = false,
    hideExtensions,
    displayName,
    onShare,
    onChange,
    onStop,
  }: {
    files: MatterFileIndex;
    sharing: SharingIndex;
    search: EntitySearch;
    /** Why this member cannot share, when they cannot. Everything still reads; nothing acts. */
    shareRefusal?: string;
    busy?: boolean;
    hideExtensions: boolean;
    displayName: (name: string, hideExtensions: boolean) => string;
    onShare: (target: SharingTarget, person: { entityId: string; name: string }, role: ShareRole) => void;
    onChange: (share: ShareSummary, changes: { role: ShareRole }) => void;
    onStop: (share: ShareSummary) => void;
  } = $props();

  const NO_ACCESS = "none";

  /*
   * People picked from the Directory in this view who hold nothing yet. They stay listed until the
   * reader shares something with them or leaves the view; holding nothing, they are not a record.
   */
  let pending = $state<{ entityId: string; name: string; initials: string }[]>([]);
  let adding = $state(false);
  let picked = $state<PickableEntity | null>(null);
  let selectedEntityId = $state<string | null>(null);
  let collapsed = $state<string[]>([]);

  const people = $derived.by(() => {
    const holding = sharing.people();
    const held = new Set(holding.map((person) => person.entityId));
    return [
      ...holding,
      ...pending
        .filter((person) => !held.has(person.entityId))
        .map((person) => ({ ...person, itemCount: 0 })),
    ];
  });

  const selected = $derived(
    people.find((person) => person.entityId === selectedEntityId) ?? people[0] ?? null,
  );

  function pick(entity: PickableEntity): void {
    adding = false;
    picked = null;
    const name = entity.name.trim() === "" ? "Unnamed person" : entity.name;
    if (!people.some((person) => person.entityId === entity.identifier)) {
      pending = [...pending, { entityId: entity.identifier, name, initials: initialsOf(name) }];
    }
    selectedEntityId = entity.identifier;
  }

  function toggle(folderId: string): void {
    collapsed = collapsed.includes(folderId)
      ? collapsed.filter((each) => each !== folderId)
      : [...collapsed, folderId];
  }

  function choose(target: SharingTarget, direct: ShareSummary | null, next: string): void {
    if (selected === null) return;
    if (next === NO_ACCESS) {
      if (direct !== null) onStop(direct);
      return;
    }
    const role = next as ShareRole;
    if (direct === null) onShare(target, { entityId: selected.entityId, name: selected.name }, role);
    else if (direct.role !== role) onChange(direct, { role });
  }

  function isLive(share: ShareSummary | null): boolean {
    return share !== null && share.dormant === null;
  }

  function folderNameOf(share: ShareSummary): string {
    if (share.scope === "matter") return "Home";
    return files.folderById(share.folderId ?? "")?.name ?? "its folder";
  }

  function detailWords(share: ShareSummary): string {
    if (share.dormant === "ended") return "";
    return [
      share.allowDownload ? null : "No download",
      share.endsOn === null ? null : `Until ${formatDate(share.endsOn)}`,
    ]
      .filter((part) => part !== null)
      .join(" · ");
  }

  /** How many of the matter's files the selected person can open, and through how many shares. */
  const reach = $derived.by(() => {
    if (selected === null) return { files: 0, shares: 0 };
    let count = 0;
    const walk = (folderId: string | null): void => {
      for (const file of files.filesIn(folderId)) {
        const access = sharing.accessFor(selected.entityId, fileTarget(file));
        const live = [access.direct, access.through].some(
          (share) => share !== null && share.dormant === null,
        );
        if (live) count += 1;
      }
      for (const folder of files.childrenOf(folderId)) walk(folder.id);
    };
    walk(null);
    return { files: count, shares: sharing.sharesOf(selected.entityId).length };
  });

  function fileTarget(file: MatterFile): SharingTarget {
    return { kind: "file", fileId: file.id, folderId: file.folderId };
  }

  function folderTarget(folder: FolderSummary): SharingTarget {
    return { kind: "folder", folderId: folder.id };
  }
</script>

<!-- Sized by the pane it sits in, not the window: the rail and the details panel decide how much
     room the list has, and they are the reader's to resize. -->
<div class="@container flex min-h-0 flex-1 flex-col">
<div class="mc-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto @2xl:flex-row @2xl:overflow-hidden">
  <!-- People. Above the outline in a narrow pane, beside it in a wide one. -->
  <section
    class="mc-scrollbar flex shrink-0 flex-col gap-8 border-b border-border-default p-12 @2xl:w-3xs @2xl:overflow-y-auto @2xl:border-e @2xl:border-b-0"
    aria-label="People"
  >
    <div class="flex items-center gap-8">
      <h3 class="text-sm font-medium">People</h3>
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
    {#if adding}
      <EntityPicker
        {search}
        kinds={["person"]}
        excluded={people.map((person) => person.entityId)}
        label="Add a person from the Directory"
        bind:value={picked}
        onSelect={pick}
      />
    {/if}
    {#if people.length === 0}
      <p class="text-sm text-text-muted">Only the firm can see this matter's files.</p>
    {:else}
      <ul class="flex flex-col gap-4">
        {#each people as person (person.entityId)}
          <li>
            <Button
              variant="ghost"
              class="h-auto w-full justify-start gap-8 px-8 py-4 text-start {selected?.entityId ===
              person.entityId
                ? 'bg-surface-selected'
                : ''}"
              aria-current={selected?.entityId === person.entityId ? "true" : undefined}
              onclick={() => (selectedEntityId = person.entityId)}
            >
              <Avatar.Root class="size-32 shrink-0 bg-status-info-subtle" aria-hidden="true">
                <Avatar.Fallback class="text-xs text-status-info-subtle-foreground">{person.initials}</Avatar.Fallback>
              </Avatar.Root>
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-sm font-medium">{person.name}</span>
                <span class="text-xs text-text-muted">
                  {person.itemCount === 0
                    ? "Nothing shared yet"
                    : person.itemCount === 1
                      ? "1 share"
                      : `${person.itemCount} shares`}
                </span>
              </span>
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- What the selected person can see, over the matter's own structure. -->
  <section class="mc-scrollbar flex min-w-0 flex-1 flex-col @2xl:overflow-y-auto" aria-label="What they can see">
    {#if selected !== null}
      <header class="flex flex-col gap-4 border-b border-border-default p-12">
        <h3 class="text-sm font-medium">What {selected.name} Can See</h3>
        <p class="text-xs text-text-muted">
          {reach.files === 1 ? "1 file" : `${reach.files} files`} on this matter. Sharing a folder covers
          the files directly inside it, not its subfolders.
        </p>
      </header>
      <ul class="flex flex-col py-4" role="list">
        {@render topLevel()}
      </ul>
    {/if}
  </section>
</div>
</div>

{#snippet accessControl(
  target: SharingTarget,
  direct: ShareSummary | null,
  through: ShareSummary | null,
  name: string,
)}
  <div class="flex shrink-0 items-center gap-8">
    {#if direct !== null}
      {@const items = [...roleItems(direct.role), { value: NO_ACCESS, label: "No Access" }]}
      <div class="w-96">
        <Select.Root
          type="single"
          {items}
          allowDeselect={false}
          disabled={busy || shareRefusal !== undefined}
          value={direct.role}
          onValueChange={(next) => choose(target, direct, next)}
        >
          <Select.Trigger aria-label="Access to {name}">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each items as option (option.value)}
              <Select.Item value={option.value} label={option.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    {:else if through !== null && through.dormant === null}
      <span class="text-sm text-text-muted">
        {ROLE_LABELS[through.role]}, through {folderNameOf(through)}
      </span>
    {:else}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || shareRefusal !== undefined}
        title={shareRefusal ?? `Share ${name} as a Viewer`}
        onclick={() => choose(target, null, "viewer")}
      >
        Share
      </Button>
    {/if}
  </div>
{/snippet}

<!-- One row of the outline: the glyph, the name (muted when the person cannot see it), what is
     true of the share beneath the name, and the control. -->
{#snippet itemLine(
  name: string,
  direct: ShareSummary | null,
  visible: boolean,
)}
  <span class="flex min-w-0 flex-1 flex-col">
    <span class="truncate text-sm {visible ? 'font-medium' : 'text-text-muted'}">{name}</span>
    {#if direct !== null && direct.dormant !== null}
      <span><Badge variant="warning">{direct.dormant === "ended" ? "Ended" : "Needs a new sharer"}</Badge></span>
    {:else if direct !== null && detailWords(direct) !== ""}
      <span class="truncate text-xs text-text-muted">{detailWords(direct)}</span>
    {/if}
  </span>
{/snippet}

{#snippet topLevel()}
  {@const target = { kind: "matter" } as const}
  {@const access = sharing.accessFor(selected?.entityId ?? "", target)}
  <li class="flex flex-col">
    <div class="flex min-h-40 items-center gap-4 px-8 py-4">
      <span class="size-24 shrink-0" aria-hidden="true"></span>
      <House class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
      {@render itemLine("Home", access.direct, isLive(access.direct))}
      {@render accessControl(target, access.direct, null, "Home")}
    </div>
    <ul class="flex flex-col ps-16" role="list">
      {#each files.childrenOf(null) as folder (folder.id)}
        {@render folderRow(folder)}
      {/each}
      {#each files.filesIn(null) as file (file.id)}
        {@render fileRow(file)}
      {/each}
    </ul>
  </li>
{/snippet}

{#snippet folderRow(folder: FolderSummary)}
  {@const target = folderTarget(folder)}
  {@const access = sharing.accessFor(selected?.entityId ?? "", target)}
  {@const open = !collapsed.includes(folder.id)}
  <li class="flex flex-col">
    <div class="flex min-h-40 items-center gap-4 px-8 py-4">
      <Button
        variant="ghost"
        size="icon"
        class="size-24 shrink-0"
        aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
        aria-expanded={open}
        onclick={() => toggle(folder.id)}
      >
        {#if open}
          <ChevronDown class="size-16" aria-hidden="true" />
        {:else}
          <ChevronRight class="size-16" aria-hidden="true" />
        {/if}
      </Button>
      <FolderGlyph class="size-16 shrink-0" />
      {@render itemLine(folder.name, access.direct, isLive(access.direct))}
      {@render accessControl(target, access.direct, null, folder.name)}
    </div>
    {#if open}
      <ul class="flex flex-col ps-16" role="list">
        {#each files.childrenOf(folder.id) as child (child.id)}
          {@render folderRow(child)}
        {/each}
        {#each files.filesIn(folder.id) as file (file.id)}
          {@render fileRow(file)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

{#snippet fileRow(file: MatterFile)}
  {@const target = fileTarget(file)}
  {@const access = sharing.accessFor(selected?.entityId ?? "", target)}
  {@const name = displayName(file.name, hideExtensions)}
  <li class="flex min-h-40 items-center gap-4 px-8 py-4">
    <span class="size-24 shrink-0" aria-hidden="true"></span>
    <FileIcon
      contentType={file.sniffedContentType ?? undefined}
      fileName={file.name}
      class="size-16 shrink-0"
    />
    {@render itemLine(name, access.direct, isLive(access.direct) || isLive(access.through))}
    {@render accessControl(target, access.direct, access.through, name)}
  </li>
{/snippet}
