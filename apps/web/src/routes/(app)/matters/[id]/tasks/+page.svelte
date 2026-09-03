<script lang="ts">
  /*
   * The matter's tasks: what the firm still owes on this case, each piece with somebody's name on
   * it.
   *
   * A task is not a deadline and not a calendar entry. A deadline is what a court or a rule requires
   * and lives on the Calendar; a task is the firm's own work. Keeping them apart is what stops the
   * deadline surface — whose whole value is that a missing entry is a malpractice event — from
   * filling up with "call the client back".
   *
   * The list and the member's own work list at /tasks are ONE component reading two routes, so a
   * task looks and behaves the same wherever it is read.
   *
   * A SAMPLE matter (the in-repo fixtures the chrome's lifecycle states are reviewed against) has no
   * firm behind it and therefore nothing to read; it says so rather than showing an empty list.
   */
  import TaskList from "$lib/matters/task-list.svelte";
  import { listMatterTasks, type TaskListFilters } from "$lib/matters/tasks-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");
</script>

<svelte:head>
  <title>Tasks · {matter.title} · Magna Carta</title>
</svelte:head>

<TaskList
  subject={matter.id}
  read={(cursor: string | undefined, filters: TaskListFilters) =>
    listMatterTasks(fetch, matter.id, cursor, filters)}
  matterId={matter.id}
  matterTitle={matter.title}
  {isSample}
  heading="Tasks"
  emptyTitle="Nothing outstanding"
  emptyDescription="No task is open on this matter. Anything the firm still owes here goes on this list, with whose it is and when it is due."
/>
