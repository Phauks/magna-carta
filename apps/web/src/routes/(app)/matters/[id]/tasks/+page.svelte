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
  import { claimMatterCreate, SAMPLE_MATTER_REFUSAL } from "$lib/matters/create-action.svelte.ts";
  import { listMatterTasks, type TaskListFilters } from "$lib/matters/tasks-api.ts";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { data }: { data: { matter: MatterRecord } } = $props();

  const matter = $derived(data.matter);
  const isSample = $derived(matter.source === "sample");

  /*
   * The matter header's New Task opens the list's new-task panel; the list draws no button of its
   * own here (create-action.svelte.ts). The permission refusal is stated on the panel's own commit,
   * so the control only refuses what it can know from here.
   */
  let list = $state<ReturnType<typeof TaskList> | null>(null);
  claimMatterCreate("tasks", () => ({
    title: "Add a task on this matter, with whose it is and when it is due.",
    refusal: isSample
      ? SAMPLE_MATTER_REFUSAL
      : list === null
        ? "The tasks are not on screen, so nothing can be added to them."
        : undefined,
    run: () => list?.openNew(),
  }));
</script>

<svelte:head>
  <title>Tasks · {matter.title} · Magna Carta</title>
</svelte:head>

<TaskList
  bind:this={list}
  ownNewButton={false}
  subject={matter.id}
  read={(cursor: string | undefined, filters: TaskListFilters) =>
    listMatterTasks(fetch, matter.id, cursor, filters)}
  matterId={matter.id}
  matterTitle={matter.title}
  {isSample}
  heading="Tasks"
/>
