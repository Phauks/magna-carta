<script lang="ts">
  /*
   * A TASK'S COMMENT THREAD, as the task window's Comments tab.
   *
   * Flat and oldest first, so it reads top to bottom in the order things were said. Typing "@" or
   * pressing Name Someone offers the firm's people; whoever is named is told, and so are the people
   * the task is assigned to and watching it, which the line under the box says before anything is
   * posted. Only the author may reword or remove a comment; a reworded one says Edited.
   */
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Textarea from "@magna-carta/design-system/textarea";
  import * as Avatar from "@magna-carta/design-system/avatar";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import {
    formatInstant,
    instantAttribute,
    placeholderOf,
  } from "@magna-carta/design-system/formatters";
  import { displayInitials } from "@magna-carta/community/display";
  import AtSign from "@lucide/svelte/icons/at-sign";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import {
    addTaskComment,
    deleteTaskComment,
    editTaskComment,
    listTaskComments,
    type MatterTask,
    type TaskComment,
    type TaskTeam,
  } from "./tasks-api.ts";
  import {
    commentSegments,
    namesStillWritten,
    toldSentence,
    withNameAdded,
    type NamedPerson,
  } from "./task-comments.ts";

  let {
    task,
    viewerUserId,
    members,
    teams,
    nameOf,
    writeRefusal,
    count = $bindable(0),
  }: {
    task: MatterTask;
    /** Who is reading, so their own comments offer Edit and Delete. */
    viewerUserId: string | null;
    /** The people a comment may name. The server refuses anybody who cannot see the task. */
    members: readonly FirmMemberSummary[];
    teams: readonly TaskTeam[];
    nameOf: (userId: string | null) => string;
    /** Why nothing here can be written, or undefined where writing is allowed. */
    writeRefusal?: string;
    /** How many comments the thread holds, for the tab's count. Bindable. */
    count?: number;
  } = $props();

  let comments = $state<TaskComment[]>([]);
  let loadFailure = $state<StatedFailure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  let draft = $state("");
  let draftNamed = $state<NamedPerson[]>([]);
  let nameMenuOpen = $state(false);
  let posting = $state(false);
  let editingId = $state<string | null>(null);
  let editText = $state("");
  let editNamed = $state<NamedPerson[]>([]);

  const people = $derived<NamedPerson[]>(
    members
      .filter((member) => member.status === "active")
      .map((member) => ({ userId: member.userId, displayName: member.displayName })),
  );

  // The people already told of any new comment, by name: the task's people and teams, and its
  // watchers, never the reader.
  const toldLine = $derived.by(() => {
    const names: string[] = [];
    for (const assignee of task.assignees) {
      if (assignee.userId !== null && assignee.userId !== viewerUserId) names.push(nameOf(assignee.userId));
      if (assignee.teamId !== null) {
        names.push(teams.find((team) => team.id === assignee.teamId)?.name ?? "A retired team");
      }
    }
    for (const watcher of task.watcherUserIds) {
      if (watcher !== viewerUserId) names.push(`${nameOf(watcher)} (watching)`);
    }
    return toldSentence([...new Set(names)]);
  });

  async function load(taskId: string): Promise<void> {
    const outcome = await listTaskComments(fetch, taskId);
    if (taskId !== task.id) return;
    if (outcome.kind === "ok") {
      comments = outcome.value.data;
      loadFailure = null;
    } else {
      loadFailure = stated(outcome.failure, "The comments could not be read.");
    }
  }

  // Keyed on the id, so a re-read of the same task does not empty the thread while it reloads.
  const taskId = $derived(task.id);
  $effect(() => {
    comments = [];
    editingId = null;
    void load(taskId);
  });

  $effect(() => {
    count = comments.length;
  });

  function namedIn(comment: TaskComment): NamedPerson[] {
    return comment.mentionedUserIds.map((userId) => ({ userId, displayName: nameOf(userId) }));
  }

  function typed(value: string): void {
    draft = value;
    if (value.endsWith("@")) nameMenuOpen = true;
  }

  function name(person: NamedPerson): void {
    draft = withNameAdded(draft, person);
    draftNamed = [...draftNamed.filter((named) => named.userId !== person.userId), person];
    nameMenuOpen = false;
  }

  async function post(): Promise<void> {
    if (draft.trim() === "" || posting) return;
    posting = true;
    writeFailure = null;
    const outcome = await addTaskComment(fetch, task.id, {
      body: draft,
      mentionedUserIds: namesStillWritten(draft, draftNamed),
    });
    posting = false;
    if (outcome.kind !== "ok") {
      writeFailure = stated(outcome.failure, "The comment was not posted.");
      return;
    }
    draft = "";
    draftNamed = [];
    await load(task.id);
  }

  function startEdit(comment: TaskComment): void {
    editingId = comment.id;
    editText = comment.body;
    editNamed = namedIn(comment);
  }

  async function saveEdit(comment: TaskComment): Promise<void> {
    if (editText.trim() === "" || posting) return;
    posting = true;
    writeFailure = null;
    const outcome = await editTaskComment(fetch, comment.id, {
      body: editText,
      mentionedUserIds: namesStillWritten(editText, editNamed),
    });
    posting = false;
    if (outcome.kind !== "ok") {
      writeFailure = stated(outcome.failure, "The comment was not changed.");
      return;
    }
    editingId = null;
    await load(task.id);
  }

  async function remove(comment: TaskComment): Promise<void> {
    posting = true;
    writeFailure = null;
    const outcome = await deleteTaskComment(fetch, comment.id);
    posting = false;
    if (outcome.kind !== "ok") {
      writeFailure = stated(outcome.failure, "The comment was not deleted.");
      return;
    }
    await load(task.id);
  }
</script>

<section aria-label="Comments" class="flex flex-col gap-12">
  {#if loadFailure !== null}
    <FailureNotice failure={loadFailure.failure} title="Not Read" fallback={loadFailure.fallback} />
  {/if}
  {#if writeFailure !== null}
    <FailureNotice failure={writeFailure.failure} title="Nothing Changed" fallback={writeFailure.fallback} />
  {/if}

  {#if comments.length === 0 && loadFailure === null}
    <p class="text-sm text-text-muted">No comments yet. Ask a question or leave word for whoever picks this up.</p>
  {:else}
    <ol class="flex flex-col gap-12">
      {#each comments as comment (comment.id)}
        {@const own = comment.authorUserId === viewerUserId}
        <li class="flex gap-12">
          <Avatar.Root>
            <Avatar.Fallback>{displayInitials(nameOf(comment.authorUserId))}</Avatar.Fallback>
          </Avatar.Root>
          <div class="flex min-w-0 flex-1 flex-col gap-4">
            <div class="flex flex-wrap items-center gap-8 text-xs">
              <span class="text-sm font-semibold">{nameOf(comment.authorUserId)}</span>
              <time class="text-text-subtle" datetime={instantAttribute(comment.createdAt)}>
                {formatInstant(comment.createdAt)}
              </time>
              {#if comment.editedAt !== null}
                <span class="text-text-subtle">Edited</span>
              {/if}
              {#if own && editingId !== comment.id && writeRefusal === undefined}
                <span class="ml-auto flex gap-4">
                  <Button variant="ghost" size="sm" disabled={posting} onclick={() => startEdit(comment)}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" disabled={posting} onclick={() => void remove(comment)}>
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </span>
              {/if}
            </div>
            {#if editingId === comment.id}
              <Textarea aria-label="Comment" bind:value={editText} rows={3} />
              <div class="flex justify-end gap-8">
                <Button variant="ghost" size="sm" onclick={() => (editingId = null)}>Discard</Button>
                <Button
                  size="sm"
                  disabled={posting || editText.trim() === ""}
                  onclick={() => void saveEdit(comment)}
                >
                  Save
                </Button>
              </div>
            {:else}
              <p class="text-sm whitespace-pre-wrap break-words">
                {#each commentSegments(comment.body, namedIn(comment)) as segment, index (index)}
                  {#if segment.named}<strong class="font-semibold">{segment.text}</strong>{:else}{segment.text}{/if}
                {/each}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}

  {#if writeRefusal === undefined}
    <div class="flex flex-col gap-8">
      <Textarea
        aria-label="New comment"
        placeholder={placeholderOf("Comment")}
        rows={3}
        value={draft}
        oninput={(event) => typed(event.currentTarget.value)}
      />
      <div class="flex flex-wrap items-center gap-8">
        <DropdownMenu.Root bind:open={nameMenuOpen}>
          <DropdownMenu.Trigger class={buttonClasses({ variant: "secondary", size: "sm" })}>
            <AtSign aria-hidden="true" />
            Name Someone
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="mc-scrollbar max-h-96 overflow-y-auto">
            {#each people as person (person.userId)}
              <DropdownMenu.Item onSelect={() => name(person)}>{person.displayName}</DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <p class="min-w-0 flex-1 text-xs text-text-muted">Type @ to name a colleague. {toldLine}</p>
        <Button size="sm" disabled={posting || draft.trim() === ""} onclick={() => void post()}>Post</Button>
      </div>
    </div>
  {:else}
    <p class="text-xs text-text-muted">{writeRefusal}</p>
  {/if}
</section>
