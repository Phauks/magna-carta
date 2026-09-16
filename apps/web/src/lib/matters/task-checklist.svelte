<script lang="ts">
  /*
   * THE CHECKLIST INSIDE A TASK: flat lines somebody ticks.
   *
   * A LINE IS NOT A TASK. It has no people, no date, no priority and no documents, and ticking every
   * line completes nothing — the task's rung is a fact somebody moves. That is the whole distinction
   * between this and the sub-task tree the design refuses: a checklist is a list of lines, and a
   * tree is a second task record with rollup rules.
   *
   * IT IS LIVE, NOT A FIELD. Ticking a line, adding one, renaming one and removing one are each
   * their own write the moment they happen, in the window's reading mode as much as its editing
   * mode — a checklist that had to be Saved would be a checklist nobody ticks. So this component
   * takes verbs rather than a bound value: the window decides whether a verb writes to the server
   * (a task that exists) or to a draft it will write with the task (a task that does not yet).
   *
   * THE ADD FIELD IS ALWAYS THE LAST LINE and Enter adds what is in it, because a checklist is
   * written by typing one thing after another and reaching for a button between each would make
   * the fifth line cost five times what the first did.
   */
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Input from "@magna-carta/design-system/input";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { placeholderOf } from "@magna-carta/design-system/formatters";

  /** One line as this component reads it — persisted or still a draft, it looks the same. */
  export interface ChecklistLine {
    readonly id: string;
    readonly title: string;
    readonly done: boolean;
    /** Who ticked it, as a name, where anybody has. */
    readonly doneByName: string | null;
  }

  let {
    lines,
    canWrite,
    disabled = false,
    refusal,
    idPrefix,
    onAdd,
    onTick,
    onRename,
    onRemove,
  }: {
    lines: readonly ChecklistLine[];
    /** Whether this account may change the list at all. */
    canWrite: boolean;
    /** A write is in flight, or the window is otherwise busy. */
    disabled?: boolean;
    /** Why nothing here can be changed, where it cannot. Stated on the refused controls. */
    refusal?: string;
    idPrefix: string;
    onAdd: (title: string) => void;
    onTick: (line: ChecklistLine, done: boolean) => void;
    onRename: (line: ChecklistLine, title: string) => void;
    onRemove: (line: ChecklistLine) => void;
  } = $props();

  let draft = $state("");
  /** The line whose words are open for change, and what they read so far. */
  let renaming = $state<{ id: string; title: string } | null>(null);

  const doneCount = $derived(lines.filter((line) => line.done).length);
  const locked = $derived(!canWrite || disabled);

  function add(): void {
    const title = draft.trim();
    if (title === "" || locked) return;
    onAdd(title);
    draft = "";
  }

  function commitRename(line: ChecklistLine): void {
    const open = renaming;
    renaming = null;
    if (open === null || open.id !== line.id) return;
    const title = open.title.trim();
    if (title === "" || title === line.title) return;
    onRename(line, title);
  }
</script>

<div class="flex flex-col gap-8">
  <div class="flex items-center justify-between gap-8">
    <span class="text-xs text-text-muted">Checklist</span>
    {#if lines.length > 0}
      <!-- The count says how far the list has come, and nothing about the task: all lines ticked is
           not Done. -->
      <span class="text-xs text-text-muted tabular-nums">{doneCount} of {lines.length}</span>
    {/if}
  </div>

  {#if lines.length > 0}
    <ul class="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
      {#each lines as line (line.id)}
        <li class="flex items-center gap-8 px-8 py-4">
          <Checkbox
            checked={line.done}
            disabled={locked}
            aria-label={line.done ? `Untick ${line.title}` : `Tick ${line.title}`}
            title={refusal}
            onCheckedChange={(next) => onTick(line, next === true)}
          />
          {#if renaming?.id === line.id}
            <Input
              id="{idPrefix}-rename-{line.id}"
              class="min-w-0 flex-1"
              aria-label="The line's words"
              value={renaming.title}
              oninput={(event) => {
                if (renaming !== null) renaming = { id: line.id, title: event.currentTarget.value };
              }}
              onkeydown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename(line);
                } else if (event.key === "Escape") {
                  renaming = null;
                }
              }}
              onblur={() => commitRename(line)}
              {@attach (node) => node.focus()}
            />
          {:else}
            <span
              class="min-w-0 flex-1 text-sm {line.done ? 'text-text-muted line-through' : ''}"
              title={line.done && line.doneByName !== null ? `Ticked by ${line.doneByName}` : undefined}
            >
              {line.title}
            </span>
            {#if canWrite}
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                title={refusal ?? "Change the line's words"}
                aria-label="Rename {line.title}"
                onclick={() => (renaming = { id: line.id, title: line.title })}
              >
                <Pencil class="size-16" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={locked}
                title={refusal ?? "Remove the line"}
                aria-label="Remove {line.title}"
                onclick={() => onRemove(line)}
              >
                <X class="size-16" aria-hidden="true" />
              </Button>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if canWrite}
    <div class="flex items-center gap-8">
      <Input
        id="{idPrefix}-new-line"
        class="min-w-0 flex-1"
        placeholder={placeholderOf("Add a line")}
        aria-label="Add a line to the checklist"
        disabled={locked}
        title={refusal}
        bind:value={draft}
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={locked || draft.trim() === ""}
        title={refusal ?? "Add this line to the checklist"}
        onclick={add}
      >
        <Plus class="size-16" aria-hidden="true" />
        Add
      </Button>
    </div>
  {:else if lines.length === 0}
    <p class="text-sm text-text-muted">No checklist.</p>
  {/if}
</div>
