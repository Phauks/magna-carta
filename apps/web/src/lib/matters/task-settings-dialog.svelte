<script lang="ts">
  /*
   * TASK SETTINGS: how the firm organises its task work. Two tabs, Lists and Teams.
   *
   * A LIST carries its own statuses, each with a name and a colour, and a flow saying which status
   * may follow which. One list is the default, where a task lands when nobody names a list. A list
   * is never deleted out from under its tasks: retiring one moves them to another list first.
   *
   * A TEAM is a name and its members. Assigning a team gives the work to whoever is in it when they
   * look, so somebody joining picks up the team's work without anybody reassigning it.
   *
   * Every change here is written as it is made. There is no Save, because each control is one fact
   * and a staged form over a dozen of them would lose them all to one refused write.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import * as Select from "@magna-carta/design-system/select";
  import * as Popover from "@magna-carta/design-system/popover";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Badge from "@magna-carta/design-system/badge";
  import { PaletteSwatches, paletteSubset } from "@magna-carta/design-system/palette";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { ApiOutcome } from "$lib/api/request.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import TaskPeopleMenu from "./task-people-menu.svelte";
  import {
    STATUS_PALETTE,
    TASK_STATUS_COLOURS,
    addTaskListStatus,
    createTaskList,
    createTaskTeam,
    makeTaskListDefault,
    removeTaskListStatus,
    renameTaskList,
    retireTaskList,
    retireTaskTeam,
    setTaskStatusFlow,
    statusColourOf,
    updateTaskListStatus,
    updateTaskTeam,
    type TaskListStatus,
    type TaskListSummary,
    type TaskTeam,
  } from "./tasks-api.ts";

  let {
    open = $bindable(false),
    lists,
    teams,
    members,
    onChanged,
  }: {
    open?: boolean;
    lists: readonly TaskListSummary[];
    teams: readonly TaskTeam[];
    members: readonly FirmMemberSummary[];
    /** Something was written: the surface reads the lists and teams again. */
    onChanged: () => void;
  } = $props();

  const STATUS_COLOURS = paletteSubset(TASK_STATUS_COLOURS.map((colour) => STATUS_PALETTE[colour]));

  let tab = $state("lists");
  let chosenListId = $state("");
  const chosenList = $derived(
    lists.find((list) => list.id === chosenListId) ?? lists.find((list) => list.isDefault) ?? lists[0],
  );
  let listName = $state("");
  let newListName = $state("");
  let newStatusName = $state("");
  let retireTargetId = $state("");
  let newTeamName = $state("");
  let saving = $state(false);
  let failure = $state<StatedFailure | null>(null);

  // The name field follows the list being looked at, and is reset only when that changes.
  let nameFor = $state<string | null>(null);
  $effect(() => {
    const list = chosenList;
    if (list === undefined || nameFor === list.id) return;
    nameFor = list.id;
    listName = list.name;
    retireTargetId = "";
  });

  async function write(
    call: () => Promise<ApiOutcome<unknown>>,
    whenRefused: string,
    after?: (value: unknown) => void,
  ): Promise<void> {
    if (saving) return;
    saving = true;
    failure = null;
    const outcome = await call();
    saving = false;
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, whenRefused);
      return;
    }
    after?.(outcome.value);
    onChanged();
  }

  function addList(): void {
    const name = newListName.trim();
    if (name === "") return;
    void write(
      () => createTaskList(fetch, name),
      "The list was not added.",
      (value) => {
        newListName = "";
        chosenListId = (value as { id: string }).id;
      },
    );
  }

  function saveStatus(status: TaskListStatus, change: Partial<Pick<TaskListStatus, "name" | "colour">>): void {
    const name = (change.name ?? status.name).trim();
    if (name === "") return;
    void write(
      () =>
        updateTaskListStatus(fetch, status.id, {
          name,
          colour: change.colour ?? status.colour,
          position: status.position,
        }),
      "The status was not changed.",
    );
  }

  function toggleFlow(status: TaskListStatus, toId: string, on: boolean): void {
    const next = on
      ? [...new Set([...status.nextStatusIds, toId])]
      : status.nextStatusIds.filter((id) => id !== toId);
    void write(() => setTaskStatusFlow(fetch, status.id, next), "The flow was not changed.");
  }

  function nameOfStatus(list: TaskListSummary, statusId: string): string {
    return list.statuses.find((status) => status.id === statusId)?.name ?? "";
  }
</script>

<ActionDialog bind:open kind="reading" heading="Task Settings" width="wide">
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice failure={failure.failure} title="Nothing Changed" fallback={failure.fallback} />
    {/if}
  {/snippet}

  {#snippet fields()}
    <Tabs.Root bind:value={tab}>
      <Tabs.List>
        <Tabs.Trigger value="lists">Lists</Tabs.Trigger>
        <Tabs.Trigger value="teams">Teams</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="lists" class="flex flex-col gap-16 pt-16">
        <div class="flex flex-wrap items-end gap-8">
          <div class="flex min-w-48 flex-col gap-4">
            <Label for="task-settings-list">List</Label>
            <Select.Root type="single" bind:value={chosenListId}>
              <Select.Trigger id="task-settings-list">{chosenList?.name ?? "Choose a list"}</Select.Trigger>
              <Select.Content>
                {#each lists as list (list.id)}
                  <Select.Item value={list.id} label={list.name} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <form
            class="flex items-end gap-8"
            onsubmit={(event) => {
              event.preventDefault();
              addList();
            }}
          >
            <div class="flex flex-col gap-4">
              <Label for="task-settings-new-list">New List</Label>
              <Input id="task-settings-new-list" bind:value={newListName} disabled={saving} />
            </div>
            <Button type="submit" variant="secondary" disabled={saving || newListName.trim() === ""}>
              <Plus aria-hidden="true" />
              Add List
            </Button>
          </form>
        </div>

        {#if chosenList !== undefined}
          {@const list = chosenList}
          <section class="flex flex-col gap-12 rounded-md border border-border-default p-16">
            <div class="flex flex-wrap items-end gap-8">
              <form
                class="flex items-end gap-8"
                onsubmit={(event) => {
                  event.preventDefault();
                  const name = listName.trim();
                  if (name !== "" && name !== list.name) {
                    void write(() => renameTaskList(fetch, list.id, name), "The list was not renamed.");
                  }
                }}
              >
                <div class="flex flex-col gap-4">
                  <Label for="task-settings-list-name">Name</Label>
                  <Input id="task-settings-list-name" bind:value={listName} disabled={saving} />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={saving || listName.trim() === "" || listName.trim() === list.name}
                >
                  Rename
                </Button>
              </form>
              {#if list.isDefault}
                <Badge variant="neutral">Default</Badge>
              {:else}
                <Button
                  variant="ghost"
                  disabled={saving}
                  title="New tasks land on this list when nobody names one"
                  onclick={() => void write(() => makeTaskListDefault(fetch, list.id), "The default was not changed.")}
                >
                  Make Default
                </Button>
              {/if}
            </div>

            <div class="flex flex-col gap-8">
              <h3 class="text-sm font-semibold">Statuses</h3>
              <ul class="flex flex-col gap-8">
                {#each list.statuses as status (status.id)}
                  {@const others = list.statuses.filter((other) => other.id !== status.id)}
                  <li class="flex flex-wrap items-center gap-8">
                    <Popover.Root>
                      <Popover.Trigger
                        class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
                        aria-label={`Colour of ${status.name}`}
                        title={`Colour of ${status.name}`}
                        disabled={saving}
                      >
                        <span class="mc-palette-pip" data-palette-color={STATUS_PALETTE[status.colour]} aria-hidden="true"
                        ></span>
                      </Popover.Trigger>
                      <Popover.Content class="w-auto">
                        <PaletteSwatches
                          colors={STATUS_COLOURS}
                          value={STATUS_PALETTE[status.colour]}
                          label={`Colour of ${status.name}`}
                          onchoose={(chosen) => saveStatus(status, { colour: statusColourOf(chosen) })}
                        />
                      </Popover.Content>
                    </Popover.Root>
                    <Input
                      class="w-48"
                      aria-label={`Name of ${status.name}`}
                      value={status.name}
                      disabled={saving}
                      onchange={(event) => saveStatus(status, { name: event.currentTarget.value })}
                    />
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger
                        class={buttonClasses({ variant: "ghost", size: "sm" })}
                        disabled={saving || others.length === 0}
                        title="Which statuses a task may move to from this one"
                      >
                        <ArrowRight aria-hidden="true" />
                        {status.nextStatusIds.length === 0
                          ? "Moves Nowhere"
                          : status.nextStatusIds.map((id) => nameOfStatus(list, id)).join(", ")}
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="start">
                        <DropdownMenu.Group>
                          <DropdownMenu.GroupHeading>Can Move To</DropdownMenu.GroupHeading>
                          {#each others as other (other.id)}
                            <DropdownMenu.CheckboxItem
                              checked={status.nextStatusIds.includes(other.id)}
                              closeOnSelect={false}
                              onCheckedChange={(on) => toggleFlow(status, other.id, on === true)}
                            >
                              {other.name}
                            </DropdownMenu.CheckboxItem>
                          {/each}
                        </DropdownMenu.Group>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={saving || list.statuses.length <= 1}
                      aria-label={`Remove ${status.name}`}
                      title={list.statuses.length <= 1
                        ? "A list keeps at least one status"
                        : `Remove ${status.name}. A status a task is on cannot be removed.`}
                      onclick={() => void write(() => removeTaskListStatus(fetch, status.id), "The status was not removed.")}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                {/each}
              </ul>
              <form
                class="flex items-end gap-8"
                onsubmit={(event) => {
                  event.preventDefault();
                  const name = newStatusName.trim();
                  if (name === "") return;
                  void write(
                    () => addTaskListStatus(fetch, list.id, { name, colour: "blue" }),
                    "The status was not added.",
                    () => (newStatusName = ""),
                  );
                }}
              >
                <div class="flex flex-col gap-4">
                  <Label for="task-settings-new-status">New Status</Label>
                  <Input id="task-settings-new-status" bind:value={newStatusName} disabled={saving} />
                </div>
                <Button type="submit" variant="secondary" disabled={saving || newStatusName.trim() === ""}>
                  <Plus aria-hidden="true" />
                  Add Status
                </Button>
              </form>
            </div>

            {#if !list.isDefault && lists.length > 1}
              {@const targets = lists.filter((other) => other.id !== list.id)}
              <div class="flex flex-wrap items-end gap-8 border-t border-border-subtle pt-12">
                <div class="flex min-w-48 flex-col gap-4">
                  <Label for="task-settings-retire-target">Move Its Tasks To</Label>
                  <Select.Root type="single" bind:value={retireTargetId}>
                    <Select.Trigger id="task-settings-retire-target">
                      {targets.find((other) => other.id === retireTargetId)?.name ?? "Choose a list"}
                    </Select.Trigger>
                    <Select.Content>
                      {#each targets as other (other.id)}
                        <Select.Item value={other.id} label={other.name} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <Button
                  variant="destructive"
                  disabled={saving || retireTargetId === ""}
                  title="Retire this list, moving its tasks to the list chosen"
                  onclick={() =>
                    void write(
                      () => retireTaskList(fetch, list.id, retireTargetId),
                      "The list was not retired.",
                      () => (chosenListId = retireTargetId),
                    )}
                >
                  Retire List
                </Button>
              </div>
            {/if}
          </section>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="teams" class="flex flex-col gap-16 pt-16">
        <ul class="flex flex-col gap-8">
          {#each teams as team (team.id)}
            <li class="flex flex-wrap items-center gap-8">
              <Input
                class="w-56"
                aria-label={`Name of ${team.name}`}
                value={team.name}
                disabled={saving}
                onchange={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name === "" || name === team.name) return;
                  void write(
                    () => updateTaskTeam(fetch, team.id, { name, memberUserIds: team.memberUserIds }),
                    "The team was not renamed.",
                  );
                }}
              />
              <TaskPeopleMenu
                label={`${String(team.memberUserIds.length)} ${team.memberUserIds.length === 1 ? "Member" : "Members"}`}
                chosen={team.memberUserIds.map((userId) => ({ userId }))}
                {members}
                disabled={saving}
                onchange={(next) =>
                  void write(
                    () =>
                      updateTaskTeam(fetch, team.id, {
                        name: team.name,
                        memberUserIds: next.flatMap((entry) => ("userId" in entry ? [entry.userId] : [])),
                      }),
                    "The team was not changed.",
                  )}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={saving}
                aria-label={`Retire ${team.name}`}
                title={`Retire ${team.name}. Tasks assigned to it keep their other assignees.`}
                onclick={() => void write(() => retireTaskTeam(fetch, team.id), "The team was not retired.")}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          {:else}
            <li class="text-sm text-text-muted">No teams yet.</li>
          {/each}
        </ul>
        <form
          class="flex items-end gap-8"
          onsubmit={(event) => {
            event.preventDefault();
            const name = newTeamName.trim();
            if (name === "") return;
            void write(
              () => createTaskTeam(fetch, { name, memberUserIds: [] }),
              "The team was not added.",
              () => (newTeamName = ""),
            );
          }}
        >
          <div class="flex flex-col gap-4">
            <Label for="task-settings-new-team">New Team</Label>
            <Input id="task-settings-new-team" bind:value={newTeamName} disabled={saving} />
          </div>
          <Button type="submit" variant="secondary" disabled={saving || newTeamName.trim() === ""}>
            <Plus aria-hidden="true" />
            Add Team
          </Button>
        </form>
      </Tabs.Content>
    </Tabs.Root>
  {/snippet}
</ActionDialog>
