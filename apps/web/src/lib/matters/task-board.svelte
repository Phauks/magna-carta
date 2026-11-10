<script lang="ts">
  /*
   * THE TASKS AS A BOARD: one list at a time, one column per status, in the list's own order.
   *
   * One list, because each list has its own statuses: a board across lists would need a column for
   * every status of every list, and most of them would be empty for most of the cards.
   *
   * A CARD MOVES WHERE THE FLOW ALLOWS. While a card is carried, only the statuses its list's flow
   * leads to from where it stands accept it; the rest fade, so a refused drop is visible before it is
   * attempted rather than explained after. Finishing is not a status, so Mark Complete is a drop zone
   * after the last column rather than a column of its own, and a card dropped there keeps its status.
   *
   * Sub-tasks are not cards: they are counted on their parent's card and opened from its window,
   * because a board of every sub-task would separate each one from the work it belongs to.
   */
  import { formatDate } from "@magna-carta/design-system/data-table";
  import {
    ITEM_DRAG_KEY_ATTRIBUTE,
    ITEM_DROP_KEY_ATTRIBUTE,
    createItemDrag,
  } from "@magna-carta/design-system/item-drag";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import CornerDownRight from "@lucide/svelte/icons/corner-down-right";
  import {
    PRIORITY_LABELS,
    STATUS_PALETTE,
    isOverdue,
    type MatterTask,
    type TaskListSummary,
  } from "./tasks-api.ts";
  import { assigneeNames, statusesReachableFrom, type TaskColumnContext } from "./task-columns.ts";

  let {
    tasks,
    list,
    context,
    disabled = false,
    onMove,
    onComplete,
    onOpen,
  }: {
    /** Every task held, sub-tasks included; the board shows the top-level ones on `list`. */
    tasks: readonly MatterTask[];
    list: TaskListSummary | undefined;
    context: TaskColumnContext;
    disabled?: boolean;
    onMove: (task: MatterTask, statusId: string) => void;
    onComplete: (task: MatterTask) => void;
    onOpen: (task: MatterTask) => void;
  } = $props();

  const COMPLETE_KEY = "complete";

  const cards = $derived(
    tasks.filter((task) => task.parentTaskId === null && list !== undefined && task.listId === list.id),
  );
  const byId = $derived(new Map(cards.map((task) => [task.id, task])));

  function subtaskCount(task: MatterTask): { done: number; total: number } {
    const children = tasks.filter((candidate) => candidate.parentTaskId === task.id);
    return {
      done: children.filter((child) => child.completedAt !== null).length,
      total: children.length,
    };
  }

  const nextFrom = (statusId: string | null): readonly string[] => statusesReachableFrom(list, statusId);

  const drag = createItemDrag({
    keysFor: (key) => [key],
    describe: (keys) => byId.get(keys[0] ?? "")?.title ?? "A task",
    accepts: (keys, targetKey) => {
      const task = byId.get(keys[0] ?? "");
      if (task === undefined || disabled || task.archivedAt !== null) return false;
      if (targetKey === COMPLETE_KEY) return task.completedAt === null;
      return targetKey !== task.statusId && nextFrom(task.statusId).includes(targetKey);
    },
    onDrop: (keys, targetKey) => {
      const task = byId.get(keys[0] ?? "");
      if (task === undefined) return;
      if (targetKey === COMPLETE_KEY) onComplete(task);
      else onMove(task, targetKey);
    },
  });
  const handlers = $derived(drag.handlers());

  /** The card being carried, while one is. */
  const carried = $derived(byId.get(drag.draggedKeys[0] ?? ""));

  function faded(statusId: string): boolean {
    if (carried === undefined) return false;
    return statusId !== carried.statusId && !nextFrom(carried.statusId).includes(statusId);
  }

  function initials(name: string): string {
    return name
      .split(" ")
      .filter((word) => word !== "")
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }
</script>

{#if list === undefined}
  <p class="text-sm text-text-muted">Choose a list to see it as a board.</p>
{:else}
  <div class="mc-scrollbar flex min-h-0 flex-1 gap-12 overflow-x-auto pb-8" {...handlers}>
    {#each list.statuses as status (status.id)}
      {@const column = cards.filter((task) => task.statusId === status.id)}
      <section
        class="flex w-64 shrink-0 flex-col gap-8 rounded-md bg-surface-sunken p-8 transition-opacity"
        class:opacity-40={faded(status.id)}
        aria-label={status.name}
        {...{ [ITEM_DROP_KEY_ATTRIBUTE]: status.id }}
      >
        <header class="flex items-center gap-8 px-4 pt-4">
          <span class="mc-palette-pip" data-palette-color={STATUS_PALETTE[status.colour]} aria-hidden="true"
          ></span>
          <h3 class="text-sm font-semibold">{status.name}</h3>
          <span class="text-xs text-text-muted">{column.length}</span>
          {#if faded(status.id)}
            <span class="ms-auto text-xs text-text-muted">Not a next step</span>
          {/if}
        </header>
        <ul class="mc-scrollbar flex min-h-16 flex-col gap-8 overflow-y-auto">
          {#each column as task (task.id)}
            {@const people = assigneeNames(task, context)}
            {@const subtasks = subtaskCount(task)}
            {@const ticked = task.checklist.filter((item) => item.doneAt !== null).length}
            <li
              draggable={disabled || task.archivedAt !== null ? undefined : "true"}
              {...{ [ITEM_DRAG_KEY_ATTRIBUTE]: task.id }}
              class="rounded-md border border-border-default bg-surface-default"
              class:opacity-60={task.completedAt !== null || task.archivedAt !== null}
            >
              <button
                type="button"
                class="flex w-full flex-col gap-4 p-8 text-left"
                title="Open this task"
                onclick={() => onOpen(task)}
              >
                {#if context.showMatter}
                  <span class="truncate text-xs text-text-muted">{context.matterTitle(task.matterId)}</span>
                {/if}
                <span class="text-sm font-semibold">{task.title}</span>
                <span class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
                  {#if task.completedAt !== null}
                    <span class="inline-flex items-center gap-4"><CircleCheck aria-hidden="true" class="size-12" />Completed</span>
                  {:else if task.dueOn !== null}
                    <span class:text-text-danger={isOverdue(task)} class:font-semibold={isOverdue(task)}>
                      {formatDate(task.dueOn)}
                    </span>
                  {/if}
                  {#if task.priority !== "normal"}
                    <span class="font-semibold" class:text-text-danger={task.priority === "urgent"}>
                      {PRIORITY_LABELS[task.priority]}
                    </span>
                  {/if}
                  {#if task.checklist.length > 0}
                    <span class="inline-flex items-center gap-2" title="Checklist lines ticked">
                      <ListChecks aria-hidden="true" class="size-12" />{ticked}/{task.checklist.length}
                    </span>
                  {/if}
                  {#if subtasks.total > 0}
                    <span class="inline-flex items-center gap-2" title="Sub-tasks completed">
                      <CornerDownRight aria-hidden="true" class="size-12" />{subtasks.done}/{subtasks.total}
                    </span>
                  {/if}
                  {#if people.length > 0}
                    <span class="ms-auto flex gap-2" title={people.join(", ")}>
                      {#each people.slice(0, 3) as name, index (index)}
                        <span
                          class="inline-flex size-24 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-text-default"
                          aria-hidden="true">{initials(name)}</span
                        >
                      {/each}
                      <span class="sr-only">Assigned to {people.join(", ")}</span>
                    </span>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    <section
      class="flex w-48 shrink-0 flex-col items-center justify-center gap-4 rounded-md border-2 border-dashed border-border-default p-12 text-center text-text-muted"
      aria-label="Mark Complete"
      {...{ [ITEM_DROP_KEY_ATTRIBUTE]: COMPLETE_KEY }}
    >
      <CircleCheck aria-hidden="true" class="size-16" />
      <span class="text-sm font-semibold">Mark Complete</span>
      <span class="text-xs">Drop a card here. It keeps its status.</span>
    </section>
  </div>
{/if}
