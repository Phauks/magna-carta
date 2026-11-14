<script lang="ts">
  /*
   * The matter's exhibits: the sets on the left, the open set as a table on the right.
   *
   * A SET IS NUMBERED BY ITS ORDER. Labels are never typed: they are the row's position read through
   * the set's numbering, so moving a row moves labels. A reorder is therefore held on screen first,
   * with a strip naming every label it changes, and only Save Order sends it.
   *
   * A SET THAT FOLLOWS A FOLDER IS BROUGHT UP TO DATE WHEN IT OPENS. Files added to the folder join
   * at the end and files taken out leave; the member's arranged order is kept. Once the set is
   * marked as filed it stops following, because a filed set never changes.
   *
   * "All exhibits on this matter" is the register: every exhibit once, with where it appears.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { statusBadgeAttributes } from "@magna-carta/design-system/status-register";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatDate } from "@magna-carta/design-system/formatters";
  import { labelMoves } from "@magna-carta/exhibits/label-moves";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import FileText from "@lucide/svelte/icons/file-text";
  import Folder from "@lucide/svelte/icons/folder";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import Hash from "@lucide/svelte/icons/hash";
  import Lock from "@lucide/svelte/icons/lock";
  import Pin from "@lucide/svelte/icons/pin";
  import Send from "@lucide/svelte/icons/send";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { DragReorderController } from "$lib/components/drag-reorder.svelte.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { listMatterFolders, type FolderSummary } from "$lib/file-manager/folder-api.ts";
  import { entryFromUrl } from "$lib/matters/entry-from-url.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import AddExhibitsDialog from "$lib/exhibits/add-exhibits-dialog.svelte";
  import MarkAsFiledDialog from "$lib/exhibits/mark-as-filed-dialog.svelte";
  import NewSetDialog from "$lib/exhibits/new-set-dialog.svelte";
  import NumberingDialog from "$lib/exhibits/numbering-dialog.svelte";
  import WithdrawDialog from "$lib/exhibits/withdraw-dialog.svelte";
  import {
    ISSUE_EXHIBITS_PERMISSION,
    MANAGE_EXHIBITS_PERMISSION,
    editExhibitSet,
    followExhibitSetFolder,
    listExhibitSets,
    listMatterExhibits,
    readExhibitSet,
    removeExhibitSetMember,
    reorderExhibitSet,
    type ExhibitSetDetail,
    type ExhibitSetMember,
    type ExhibitSetSummary,
    type MatterExhibit,
  } from "$lib/exhibits/exhibits-api.ts";
  import { DISPOSITION_WORDS, draftLabel, schemeSummary } from "$lib/exhibits/exhibit-words.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  /** What the right column shows: a set by id, or the matter's register. */
  const REGISTER = "register";

  let sets = $state<ExhibitSetSummary[] | null>(null);
  let setsFailure = $state<Failure | null>(null);
  let register = $state<MatterExhibit[]>([]);
  let folders = $state<readonly FolderSummary[]>([]);
  let session = $state<SessionBootstrap | null>(null);
  let selected = $state<string | null>(null);
  let reloadToken = $state(0);

  let detail = $state<ExhibitSetDetail | null>(null);
  let detailFailure = $state<Failure | null>(null);
  let detailToken = $state(0);
  /** A folder that could not be followed: the set still opens, as it last stood. */
  let followFailure = $state<Failure | null>(null);
  let actionFailure = $state<Failure | null>(null);

  /** The order on screen while a reorder is held, as member ids; null when nothing is held. */
  let pendingOrder = $state<string[] | null>(null);
  let savingOrder = $state(false);

  let newSetOpen = $state(false);
  let addOpen = $state(false);
  let numberingOpen = $state(false);
  let fileOpen = $state(false);
  let withdrawOpen = $state(false);
  let withdrawing = $state<ExhibitSetMember | null>(null);

  const canManage = $derived(
    session === null || session.permissions.includes(MANAGE_EXHIBITS_PERMISSION),
  );
  const canIssue = $derived(
    session === null || session.permissions.includes(ISSUE_EXHIBITS_PERMISSION),
  );

  /* The sets and the register, re-read after any write. */
  $effect(() => {
    const matterId = matter.id;
    void reloadToken;
    if (isSample) {
      sets = [];
      return;
    }
    void listExhibitSets(fetch, matterId).then((outcome) => {
      if (outcome.kind === "ok") {
        sets = outcome.value;
        setsFailure = null;
      } else {
        setsFailure = outcome.failure;
        sets = sets ?? [];
      }
    });
    void listMatterExhibits(fetch, matterId).then((outcome) => {
      register = outcome.kind === "ok" ? outcome.value : [];
    });
  });

  $effect(() => {
    const matterId = matter.id;
    if (isSample) return;
    void readSession(fetch).then((outcome) => {
      session = outcome.kind === "ok" ? outcome.value : null;
    });
    void listMatterFolders(fetch, matterId).then((outcome) => {
      folders = outcome.kind === "ok" ? outcome.value.data : [];
    });
  });

  /*
   * Which set is open: the one the address names, else the one already open, else the first draft,
   * else the first set. The address is honoured each time it changes, so Files' Make Exhibits lands
   * on the set it just started.
   */
  let honouredEntry = $state<string | null>(null);
  $effect(() => {
    const list = sets;
    if (list === null) return;
    const entry = entryFromUrl();
    if (entry !== null && entry !== honouredEntry && list.some((set) => set.id === entry)) {
      honouredEntry = entry;
      selected = entry;
      return;
    }
    if (selected === REGISTER) return;
    if (selected !== null && list.some((set) => set.id === selected)) return;
    selected = (list.find((set) => set.state === "draft") ?? list[0])?.id ?? null;
  });

  const selectedSummary = $derived(sets?.find((set) => set.id === selected) ?? null);

  /* The open set, followed to its folder first when it is a draft that follows one. */
  $effect(() => {
    const summary = selectedSummary;
    void detailToken;
    pendingOrder = null;
    actionFailure = null;
    if (summary === null) {
      detail = null;
      return;
    }
    const matterId = matter.id;
    const setId = summary.id;
    const follows = summary.state === "draft" && summary.sourceFolderId !== null;
    void (async () => {
      followFailure = null;
      if (follows) {
        const followed = await followExhibitSetFolder(fetch, matterId, setId);
        if (followed.kind !== "ok") followFailure = followed.failure;
      }
      const outcome = await readExhibitSet(fetch, matterId, setId);
      if (selected !== setId) return;
      if (outcome.kind === "ok") {
        detail = outcome.value;
        detailFailure = null;
      } else {
        detailFailure = outcome.failure;
      }
    })();
  });

  const shownDetail = $derived(detail !== null && detail.id === selected ? detail : null);
  const isDraft = $derived(shownDetail?.state === "draft");
  const followedFolder = $derived(
    shownDetail?.sourceFolderId === null || shownDetail === null
      ? null
      : (folders.find((folder) => folder.id === shownDetail.sourceFolderId) ?? null),
  );

  /* The rows as they stand on screen: the held order when there is one, else the saved order. */
  const savedOrder = $derived(shownDetail?.members.map((member) => member.id) ?? []);
  const rows = $derived.by((): ExhibitSetMember[] => {
    if (shownDetail === null) return [];
    if (pendingOrder === null) return shownDetail.members;
    const byId = new Map(shownDetail.members.map((member) => [member.id, member]));
    return pendingOrder.flatMap((id) => byId.get(id) ?? []);
  });
  const moves = $derived(
    shownDetail === null || pendingOrder === null
      ? []
      : labelMoves(savedOrder, pendingOrder, shownDetail.scheme),
  );
  const movedFrom = $derived(new Map(moves.map((move) => [move.memberId, move.from])));
  const titleOf = $derived(
    new Map((shownDetail?.members ?? []).map((member) => [member.id, member.title])),
  );

  function refreshAll(): void {
    reloadToken += 1;
    detailToken += 1;
  }

  claimMatterCreate("exhibits", () => ({
    title: "Start a set of exhibits for a filing, by hand or from a folder of this matter's files.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : !canManage
        ? permissionRefusal("Starting an exhibit set", MANAGE_EXHIBITS_PERMISSION)
        : undefined,
    run: () => (newSetOpen = true),
  }));

  function choose(setId: string): void {
    selected = setId;
    const url = new URL(page.url);
    if (setId === REGISTER) url.searchParams.delete("entry");
    else url.searchParams.set("entry", setId);
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  /* Reordering. Drag a grip, or use the row menu; either holds the order until Save Order. */
  const drag = new DragReorderController();

  function moveTo(memberId: string, toIndex: number): void {
    const order = [...(pendingOrder ?? savedOrder)];
    const from = order.indexOf(memberId);
    if (from === -1) return;
    order.splice(from, 1);
    order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, memberId);
    pendingOrder = order.every((id, index) => id === savedOrder[index]) ? null : order;
  }

  function beginDrag(event: PointerEvent, memberId: string): void {
    if (savingOrder) return;
    drag.start(event, memberId, pendingOrder ?? savedOrder, moveTo);
  }

  function onGripKeydown(event: KeyboardEvent, memberId: string, index: number): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveTo(memberId, index + (event.key === "ArrowUp" ? -1 : 1));
  }

  async function saveOrder(): Promise<void> {
    if (shownDetail === null || pendingOrder === null) return;
    savingOrder = true;
    actionFailure = null;
    const outcome = await reorderExhibitSet(fetch, matter.id, shownDetail.id, pendingOrder);
    savingOrder = false;
    if (outcome.kind === "ok") {
      refreshAll();
    } else {
      actionFailure = outcome.failure;
    }
  }

  async function removeMember(member: ExhibitSetMember): Promise<void> {
    if (shownDetail === null) return;
    actionFailure = null;
    const outcome = await removeExhibitSetMember(fetch, matter.id, shownDetail.id, member.id);
    if (outcome.kind === "ok") refreshAll();
    else actionFailure = outcome.failure;
  }

  async function archiveSet(): Promise<void> {
    if (shownDetail === null) return;
    actionFailure = null;
    const outcome = await editExhibitSet(fetch, matter.id, shownDetail.id, { archived: true });
    if (outcome.kind === "ok") {
      selected = null;
      refreshAll();
    } else {
      actionFailure = outcome.failure;
    }
  }

  function stateLine(set: ExhibitSetSummary): string {
    if (set.state === "issued" && set.disposition !== null) {
      const day = set.issuedOn === null ? "" : ` ${formatDate(set.issuedOn)}`;
      return `${DISPOSITION_WORDS[set.disposition]}${day}`;
    }
    return "Draft";
  }

  function countLine(set: ExhibitSetSummary): string {
    const count = `${String(set.memberCount)} ${set.memberCount === 1 ? "exhibit" : "exhibits"}`;
    if (set.memberCount === 0) return count;
    const first = draftLabel(1, set.scheme);
    const last = draftLabel(set.memberCount, set.scheme);
    return set.memberCount === 1 ? `${count}, ${first}` : `${count}, ${first} to ${last}`;
  }

  const setsInUse = $derived(
    new Set(register.flatMap((exhibit) => exhibit.appearances.map((each) => each.setId))).size,
  );

  const fileRefusal = $derived.by((): string | undefined => {
    if (!canIssue) return permissionRefusal("Marking a set as filed", ISSUE_EXHIBITS_PERMISSION);
    if (pendingOrder !== null) return "Save or undo the new order first.";
    if ((shownDetail?.members.length ?? 0) === 0) return "Add at least one exhibit first.";
    return undefined;
  });
</script>

<svelte:head>
  <title>Exhibits · {matter.title} · Magna Carta</title>
</svelte:head>

<section class="flex min-h-0 flex-1 flex-col gap-16 lg:flex-row lg:gap-32">
  <!-- The sets, then the register. -->
  <nav class="flex flex-col gap-8 lg:w-72 lg:shrink-0" aria-label="Exhibit sets">
    <FieldLabel as="h2">Exhibit Sets</FieldLabel>
    {#if setsFailure !== null && (sets?.length ?? 0) === 0}
      <FailureNotice
        failure={setsFailure}
        title="Exhibit Sets Unavailable"
        fallback="Couldn't load this matter's exhibit sets."
        onRetry={refreshAll}
      />
    {:else if sets === null}
      <p class="text-sm text-text-muted" aria-live="polite">Reading this matter's exhibit sets</p>
    {:else if sets.length === 0}
      <p class="text-sm text-text-muted">
        {isSample ? "This is a sample matter, so it has no exhibits." : "No exhibit sets yet."}
      </p>
    {:else}
      <ul class="flex flex-col gap-4">
        {#each sets as set (set.id)}
          <li>
            <button
              type="button"
              class="flex w-full flex-col gap-4 rounded-md border px-12 py-8 text-left {selected ===
              set.id
                ? 'border-border-strong bg-surface-sunken'
                : 'border-transparent hover:bg-surface-sunken'}"
              aria-current={selected === set.id ? "true" : undefined}
              onclick={() => choose(set.id)}
            >
              <span class="text-sm font-medium">{set.name}</span>
              <span class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
                {#if set.state === "issued"}
                  <Badge variant="info"><Lock class="size-12" aria-hidden="true" />{stateLine(set)}</Badge>
                {:else}
                  <Badge {...statusBadgeAttributes("draft")}>Draft</Badge>
                {/if}
                <span>{countLine(set)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if !isSample && sets !== null}
      <div class="border-t border-border-subtle pt-8">
        <button
          type="button"
          class="flex w-full flex-col gap-4 rounded-md border px-12 py-8 text-left {selected ===
          REGISTER
            ? 'border-border-strong bg-surface-sunken'
            : 'border-transparent hover:bg-surface-sunken'}"
          aria-current={selected === REGISTER ? "true" : undefined}
          onclick={() => choose(REGISTER)}
        >
          <span class="text-sm font-medium">All exhibits on this matter</span>
          <span class="text-xs text-text-muted">
            {register.length}
            {register.length === 1 ? "exhibit" : "exhibits"} in {setsInUse}
            {setsInUse === 1 ? "set" : "sets"}
          </span>
        </button>
      </div>
    {/if}
  </nav>

  <div class="flex min-w-0 flex-1 flex-col gap-16">
    {#if selected === REGISTER}
      <FieldLabel as="h2">All Exhibits on This Matter</FieldLabel>
      <DataTable.Root>
          <DataTable.Caption class="sr-only">All exhibits on this matter</DataTable.Caption>
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head class="w-full">Title</DataTable.Head>
              <DataTable.Head class="hidden md:table-cell">File</DataTable.Head>
              <DataTable.Head>Appears In</DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#if register.length === 0}
              <DataTable.EmptyRow columns={3} title="No exhibits on this matter yet" />
            {/if}
            {#each register as exhibit (exhibit.id)}
              <DataTable.Row>
                <DataTable.Cell class="whitespace-normal">
                  <span class="flex flex-col">
                    <span>{exhibit.title}</span>
                    <span class="text-xs text-text-muted">{exhibit.referenceName}</span>
                  </span>
                </DataTable.Cell>
                <DataTable.Cell class="hidden whitespace-normal md:table-cell">
                  {exhibit.fileName ?? "Not recorded"}
                </DataTable.Cell>
                <DataTable.Cell class="whitespace-normal">
                  {#if exhibit.appearances.length === 0}
                    <span class="text-text-muted">No set</span>
                  {:else}
                    <span class="flex flex-col">
                      {#each exhibit.appearances as appearance (appearance.setId)}
                        <span>{appearance.label} in {appearance.setName}</span>
                      {/each}
                    </span>
                  {/if}
                </DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
    {:else if selectedSummary === null}
      <!-- structured-empty-allow: no set is chosen, so there is no table to frame; this says how to start one -->
      {#if sets !== null}
        <EmptyState
          title={isSample
            ? "This is a sample matter, so it has no exhibits."
            : "Start a set with New Set, or choose a folder in Files and use Make Exhibits."}
        />
      {/if}
    {:else}
      <LoadingRegion
        loading={shownDetail === null && detailFailure === null}
        failed={shownDetail === null && detailFailure !== null}
        empty={false}
        label="Reading this exhibit set"
        onRetry={() => (detailToken += 1)}
        class="flex min-w-0 flex-col gap-16"
      >
        {#snippet failure()}
          {#if detailFailure !== null}
            <FailureNotice
              failure={detailFailure}
              title="Exhibit Set Unavailable"
              fallback="Couldn't load this exhibit set."
              onRetry={() => (detailToken += 1)}
            />
          {/if}
        {/snippet}
        {#snippet emptyState()}{/snippet}
        {#snippet fixture()}
          <div class="h-64 rounded-md bg-surface-sunken"></div>
        {/snippet}
        {#if shownDetail !== null}
          {@const set = shownDetail}
          <div class="flex flex-wrap items-center gap-8">
            <h2 class="mr-auto flex min-w-0 items-center gap-8 font-serif text-xl">
              <span class="truncate">{set.name}</span>
              {#if set.state === "issued"}
                <Badge variant="info"><Lock class="size-12" aria-hidden="true" />{stateLine(set)}</Badge>
              {:else}
                <Badge {...statusBadgeAttributes("draft")}>Draft</Badge>
              {/if}
            </h2>
            <Button
              variant="secondary"
              size="sm"
              disabled={!isDraft || !canManage}
              title={isDraft ? "Change how this set is numbered" : "A filed set's numbering is locked"}
              onclick={() => (numberingOpen = true)}
            >
              <Hash class="size-16" aria-hidden="true" />{schemeSummary(set.scheme)}
            </Button>
            {#if isDraft}
              <Button
                variant="primary"
                size="sm"
                disabled={fileRefusal !== undefined}
                title={fileRefusal}
                onclick={() => (fileOpen = true)}
              >
                <Send class="size-16" aria-hidden="true" />Mark as Filed
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  class={buttonClasses({ variant: "ghost", size: "sm" })}
                  aria-label="More for this set"
                >
                  <Ellipsis class="size-16" aria-hidden="true" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end">
                  {#if set.sourceFolderId !== null}
                    <DropdownMenu.Item onSelect={() => (detailToken += 1)}>
                      Bring Up to Date with Folder
                    </DropdownMenu.Item>
                  {/if}
                  <DropdownMenu.Item disabled={!canManage} onSelect={() => void archiveSet()}>
                    Archive Set
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            {/if}
          </div>

          {#if set.sourceFolderId !== null}
            <p class="flex items-center gap-8 text-sm text-text-muted">
              <Folder class="size-16 shrink-0" aria-hidden="true" />
              {#if isDraft}
                Follows the folder {followedFolder?.name ?? "it was made from"}. Files added to it
                join at the end.
              {:else}
                Made from the folder {followedFolder?.name ?? "it was made from"}. It stopped following the folder when it was marked as filed.
              {/if}
            </p>
          {/if}

          {#if followFailure !== null}
            <FailureNotice
              failure={followFailure}
              title="Folder Not Checked"
              fallback="Couldn't update the set from its folder. It's shown as it was last saved."
              onRetry={() => (detailToken += 1)}
            />
          {/if}
          {#if actionFailure !== null}
            <FailureNotice
              failure={actionFailure}
              title="Nothing Changed"
              fallback="The change wasn't saved."
            />
          {/if}

          {#if moves.length > 0}
            <Alert.Root variant="warning">
              <Alert.Title>
                {moves.length}
                {moves.length === 1 ? "label changes" : "labels change"}
              </Alert.Title>
              <Alert.Description>
                <div class="flex flex-wrap items-center justify-between gap-8">
                  <span>
                    {moves
                      .map((move) => `${titleOf.get(move.memberId) ?? ""} ${move.from} to ${move.to}`)
                      .join(", ")}.
                  </span>
                  <span class="flex gap-8">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={savingOrder}
                      onclick={() => (pendingOrder = null)}
                    >
                      Undo
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={savingOrder}
                      onclick={() => void saveOrder()}
                    >
                      {savingOrder ? "Saving" : "Save Order"}
                    </Button>
                  </span>
                </div>
              </Alert.Description>
            </Alert.Root>
          {/if}

          {#if isDraft}
            <div class="flex flex-wrap items-center gap-8">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canManage || pendingOrder !== null}
                title={!canManage
                  ? permissionRefusal("Adding exhibits", MANAGE_EXHIBITS_PERMISSION)
                  : pendingOrder !== null
                    ? "Save or undo the new order first."
                    : undefined}
                onclick={() => (addOpen = true)}
              >
                Add Exhibits
              </Button>
              <span class="text-sm text-text-muted">from this matter's files</span>
            </div>
          {/if}

          <DataTable.Root>
              <DataTable.Caption class="sr-only">The exhibits in {set.name}</DataTable.Caption>
              <DataTable.Header>
                <DataTable.Row>
                  {#if isDraft}
                    <DataTable.Head class="hidden sm:table-cell"><span class="sr-only">Move</span></DataTable.Head>
                  {/if}
                  <DataTable.Head>Exhibit</DataTable.Head>
                  <DataTable.Head class="w-full">Title</DataTable.Head>
                  <DataTable.Head class="hidden md:table-cell">File</DataTable.Head>
                  <DataTable.Head class="hidden lg:table-cell">Pages</DataTable.Head>
                  <DataTable.Head class="hidden lg:table-cell">Version</DataTable.Head>
                  <DataTable.Head><span class="sr-only">Actions</span></DataTable.Head>
                </DataTable.Row>
              </DataTable.Header>
              <DataTable.Body>
                {#if rows.length === 0}
                  <DataTable.EmptyRow columns={isDraft ? 7 : 6} title="No exhibits in this set yet" />
                {/if}
                {#each rows as member, index (member.id)}
                  {@const label = isDraft ? draftLabel(index + 1, set.scheme) : member.label}
                  {@const was = movedFrom.get(member.id)}
                  {@const dragging = drag.draggingId === member.id}
                  {@const shift = dragging ? drag.offsetY : drag.rowShift(member.id)}
                  {@const withdrawn = member.status === "withdrawn"}
                  <DataTable.Row
                    class="{was !== undefined ? 'bg-status-warning-subtle' : ''} {dragging
                      ? 'relative z-sticky bg-surface-raised shadow-elevation-2'
                      : 'transition-transform duration-fast ease-standard motion-reduce:transition-none'}"
                    style="transform: translateY({shift}px)"
                    data-reorder-row
                  >
                    {#if isDraft}
                      <DataTable.Cell class="hidden sm:table-cell">
                        <button
                          type="button"
                          class="flex size-24 cursor-grab touch-none select-none items-center justify-center rounded-sm text-text-muted hover:text-text-default focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed"
                          aria-roledescription="Reorderable exhibit"
                          aria-label="{set.scheme.noun} {label}. Drag, or press Alt with Arrow Up or Arrow Down, to move it"
                          title="Drag to move"
                          disabled={savingOrder || !canManage}
                          onpointerdown={(event) => beginDrag(event, member.id)}
                          onkeydown={(event) => onGripKeydown(event, member.id, index)}
                        >
                          <GripVertical class="size-16" aria-hidden="true" />
                        </button>
                      </DataTable.Cell>
                    {/if}
                    <DataTable.Cell>
                      <span class="flex flex-col">
                        <span class="font-medium whitespace-nowrap {withdrawn ? 'text-text-muted line-through' : ''}">
                          {set.scheme.noun === "" ? label : `${set.scheme.noun} ${label}`}
                        </span>
                        {#if was !== undefined}
                          <span class="text-xs text-status-warning-subtle-foreground">was {was}</span>
                        {/if}
                        {#if withdrawn}
                          <span class="text-xs text-text-muted">Withdrawn</span>
                        {/if}
                      </span>
                    </DataTable.Cell>
                    <DataTable.Cell class="whitespace-normal">
                      <span class={withdrawn ? "text-text-muted" : ""}>{member.title}</span>
                    </DataTable.Cell>
                    <DataTable.Cell class="hidden whitespace-normal md:table-cell">
                      <span class="flex items-center gap-8">
                        <FileText class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
                        <span class="break-words">{member.fileName ?? "Not recorded"}</span>
                      </span>
                    </DataTable.Cell>
                    <DataTable.Cell class="hidden lg:table-cell">
                      {member.pageCount ?? ""}
                    </DataTable.Cell>
                    <DataTable.Cell class="hidden whitespace-nowrap lg:table-cell">
                      {#if !isDraft}
                        <span class="flex items-center gap-4 text-text-muted">
                          <Lock class="size-12" aria-hidden="true" />As filed
                        </span>
                      {:else if member.pinnedFileVersionId !== null}
                        <span class="flex items-center gap-4">
                          <Pin class="size-12" aria-hidden="true" />Pinned
                        </span>
                      {:else}
                        <span class="text-text-muted">Latest</span>
                      {/if}
                    </DataTable.Cell>
                    <DataTable.Cell>
                      {#if isDraft || !withdrawn}
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger
                            class={buttonClasses({ variant: "ghost", size: "sm" })}
                            aria-label="More for {member.title}"
                          >
                            <Ellipsis class="size-16" aria-hidden="true" />
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Content align="end">
                            {#if isDraft}
                              <DropdownMenu.Item
                                disabled={index === 0 || !canManage}
                                onSelect={() => moveTo(member.id, 0)}
                              >
                                Move to Top
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                disabled={index === 0 || !canManage}
                                onSelect={() => moveTo(member.id, index - 1)}
                              >
                                Move Up
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                disabled={index === rows.length - 1 || !canManage}
                                onSelect={() => moveTo(member.id, index + 1)}
                              >
                                Move Down
                              </DropdownMenu.Item>
                              <DropdownMenu.Item
                                disabled={index === rows.length - 1 || !canManage}
                                onSelect={() => moveTo(member.id, rows.length - 1)}
                              >
                                Move to Bottom
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                disabled={!canManage || pendingOrder !== null}
                                onSelect={() => void removeMember(member)}
                              >
                                Remove from Set
                              </DropdownMenu.Item>
                            {:else}
                              <DropdownMenu.Item
                                disabled={!canIssue}
                                onSelect={() => {
                                  withdrawing = member;
                                  withdrawOpen = true;
                                }}
                              >
                                Withdraw
                              </DropdownMenu.Item>
                            {/if}
                          </DropdownMenu.Content>
                        </DropdownMenu.Root>
                      {/if}
                    </DataTable.Cell>
                  </DataTable.Row>
                {/each}
              </DataTable.Body>
            </DataTable.Root>

          <AddExhibitsDialog bind:open={addOpen} {set} {register} onAdded={refreshAll} />
          <NumberingDialog bind:open={numberingOpen} {set} onChanged={refreshAll} />
          <MarkAsFiledDialog bind:open={fileOpen} {set} onIssued={refreshAll} />
          <WithdrawDialog
            bind:open={withdrawOpen}
            {set}
            member={withdrawing}
            onWithdrawn={refreshAll}
          />
        {/if}
      </LoadingRegion>
    {/if}
  </div>
</section>

<NewSetDialog
  bind:open={newSetOpen}
  matterId={matter.id}
  onCreated={(setId) => {
    reloadToken += 1;
    choose(setId);
  }}
/>
