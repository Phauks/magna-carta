<script lang="ts">
  /*
   * TASKS — every task this member can reach, in one list.
   *
   * It spans the matters they can see AND their own work on no matter, because the two are one
   * question: what is on my plate. That is the whole argument for a task's matter being nullable —
   * renewing the malpractice policy is real firm work, and a task list that could not hold it would
   * send somebody to a spreadsheet for half of their day.
   *
   * Tasks on closed matters are left out. Closing a matter changes no task, so this is a filter and
   * not a state: reopening the matter brings its tasks back with no backfill.
   *
   * THE SCREEN OWNS ITS HEADER AND THE LIST OWNS ITS CONTROLS. The list hands its search, its
   * create control and its clear back here to be seated in the masthead's action row, which is
   * where every other main screen keeps that pair, rather than drawing a second row of its own
   * under the title.
   */
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import TaskList from "$lib/matters/task-list.svelte";
  import { listMyTasks, type TaskListFilters } from "$lib/matters/tasks-api.ts";
</script>

<svelte:head>
  <title>Tasks · Magna Carta</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <TaskList
    subject="tasks"
    read={(cursor: string | undefined, filters: TaskListFilters) =>
      listMyTasks(fetch, cursor, filters)}
    matterId={null}
    matterTitle={null}
    showMatter
  >
    {#snippet screenHeader(controls)}
      <ScreenHeader title="Tasks">
        {#snippet actions()}
          {@render controls()}
        {/snippet}
      </ScreenHeader>
    {/snippet}
  </TaskList>
</div>
