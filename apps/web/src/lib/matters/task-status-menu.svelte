<script lang="ts">
  /*
   * Where a task stands, as a coloured pill that opens the statuses it may move to.
   *
   * The menu offers the status the task is on and the ones its list's flow allows next, and nothing
   * else: a status the flow does not lead to is not a choice the firm gave. Finishing is not one of
   * the statuses, so Mark Complete sits at the foot of the menu, apart from them, and completing a
   * task leaves its status where it stood.
   */
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Check from "@lucide/svelte/icons/check";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import { STATUS_PALETTE, type MatterTask, type TaskListSummary } from "./tasks-api.ts";
  import { statusOf } from "./task-columns.ts";

  let {
    task,
    list,
    disabled = false,
    onMove,
    onCompletion,
  }: {
    task: MatterTask;
    /** The task's own list, whose statuses and flow the menu offers. */
    list: TaskListSummary | undefined;
    disabled?: boolean;
    onMove: (statusId: string) => void;
    onCompletion: (completed: boolean) => void;
  } = $props();

  const current = $derived(statusOf(task, list));
  const choices = $derived(
    (list?.statuses ?? []).filter(
      (status) => status.id === current?.id || (current?.nextStatusIds.includes(status.id) ?? true),
    ),
  );
  const completed = $derived(task.completedAt !== null);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    {disabled}
    class="inline-flex max-w-full items-center gap-4 rounded-full border border-border-default bg-surface-default px-8 py-2 text-xs whitespace-nowrap hover:bg-surface-sunken disabled:opacity-60"
    title={completed ? "Complete. Open to reopen or move it" : "Change where this task stands"}
  >
    {#if completed}
      <CircleCheck aria-hidden="true" class="size-12 text-text-muted" />
    {:else}
      <span
        class="mc-palette-pip"
        data-palette-color={STATUS_PALETTE[current?.colour ?? "gray"]}
        aria-hidden="true"
      ></span>
    {/if}
    <span class="truncate" class:text-text-muted={completed}>{current?.name ?? "No Status"}</span>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start">
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>Status</DropdownMenu.GroupHeading>
      {#each choices as status (status.id)}
        {@const here = status.id === current?.id}
        <DropdownMenu.Item disabled={here} onSelect={() => onMove(status.id)}>
          <span class="mc-palette-pip" data-palette-color={STATUS_PALETTE[status.colour]} aria-hidden="true"
          ></span>
          <span class="flex-1">{status.name}</span>
          {#if here}
            <Check aria-hidden="true" class="size-12" />
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Group>
    <DropdownMenu.Separator />
    {#if completed}
      <DropdownMenu.Item onSelect={() => onCompletion(false)}>
        <RotateCcw aria-hidden="true" class="size-12" />
        Reopen
      </DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item onSelect={() => onCompletion(true)}>
        <CircleCheck aria-hidden="true" class="size-12" />
        Mark Complete
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
