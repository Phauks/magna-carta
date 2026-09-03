<script lang="ts">
  /*
   * MY WORK — every task this member can reach, in one list.
   *
   * It spans the matters they can see AND their own work on no matter, because the two are one
   * question: what is on my plate. That is the whole argument for a task's matter being nullable —
   * renewing the malpractice policy is real firm work, and a task list that could not hold it would
   * send somebody to a spreadsheet for half of their day.
   *
   * Tasks on closed matters are left out. Closing a matter changes no task, so this is a filter and
   * not a state: reopening the matter brings its tasks back with no backfill.
   */
  import TaskList from "$lib/matters/task-list.svelte";
  import { listMyTasks, type TaskListFilters } from "$lib/matters/tasks-api.ts";
</script>

<svelte:head>
  <title>My Work · Magna Carta</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-16 p-24">
  <TaskList
    subject="my-work"
    read={(cursor: string | undefined, filters: TaskListFilters) =>
      listMyTasks(fetch, cursor, filters)}
    matterId={null}
    matterTitle={null}
    showMatter
    heading="My Work"
    emptyTitle="Nothing on your plate"
    emptyDescription="No task is open for you. Tasks assigned to you across every matter you can see, and your own work on no matter, land here."
  />
</div>
