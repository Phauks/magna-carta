<script lang="ts">
  /*
   * Making a task — asked for in the one action panel, the same way every other record in the
   * product is started.
   *
   * IT IS A PANEL BECAUSE STARTING A RECORD IS A MODAL ACT. A form that unfolds between the control
   * row and the rows it will join is a second place to learn where a task's fields live, and the
   * list loses its own shape — its count, its ordering, what is overdue — while somebody is typing
   * in the middle of it. The same ruling already moved matter notes and the call log off their
   * inline composers (docs/conventions/design-corrections.md, "A record is MADE in the same window
   * it is read in").
   *
   * THE LIST IS STILL THE SUBJECT UNDERNEATH. Nothing here writes to the list: the panel reports
   * that a task was created and the list re-reads, so the new row arrives in the server's own
   * ordering rather than being spliced in at whatever position the composer happened to occupy.
   *
   * WHAT THE PANEL STATES RATHER THAN ASKS is what the task will carry that nobody types — which
   * matter it lands on, and whose name goes on it as its author — so nothing is stored that the
   * writer was not shown. The matter is said once, in the subtitle, because that is the shell's
   * place for what is being acted on.
   *
   * THE ZONE TRAVELS WITH THE DATE AND IS NEVER INFERRED LATER. A date needs a zone, a time needs a
   * date, and a time typed with no date is simply not sent: "Friday" falls at two moments in Reno
   * and Boston, and a due date resolved against the reader who happens to open the list next is a
   * different deadline for each of them.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import {
    PRIORITY_LABELS,
    TASK_PRIORITIES,
    createTask,
    newWriteKey,
    viewerTimeZone,
    type TaskPriority,
  } from "$lib/matters/tasks-api.ts";

  let {
    open = $bindable(false),
    matterId,
    matterTitle,
    authorName,
    assignableMembers = [],
    canAssign = true,
    refusal: standingRefusal,
    onCreated,
  }: {
    open?: boolean;
    /** Which matter the task lands on. Null on the member's own list: firm work has no matter. */
    matterId: string | null;
    /** Named in the subtitle, so nothing is stored the writer was not shown. */
    matterTitle: string | null;
    /** Whose name goes on the task as its author. */
    authorName: string;
    /** Who the task may be put in the name of — the firm's members who are still here. */
    assignableMembers?: readonly FirmMemberSummary[];
    /** Whether putting a task in somebody else's name is offered at all. Its own permission. */
    canAssign?: boolean;
    /**
     * Why nothing can be written here at all — the account lacks the permission, or the matter is a
     * sample with no firm behind it. Stated on the commit rather than closing the panel, so a
     * reader who opened it still sees what a task carries and is told what is missing.
     */
    refusal?: string;
    /** The task was created; the list re-reads. */
    onCreated: () => void;
  } = $props();

  const identity = $props.id();

  let title = $state("");
  let body = $state("");
  let priority = $state<TaskPriority>("normal");
  let dueOn = $state("");
  let dueAtTime = $state("");
  let assignee = $state("");
  let failure = $state<StatedFailure | null>(null);

  const started = $derived(
    title.trim() !== "" ||
      body.trim() !== "" ||
      priority !== "normal" ||
      dueOn !== "" ||
      dueAtTime !== "" ||
      assignee !== "",
  );

  // Why the commit is unavailable. What the account may do outranks what the fields hold: telling
  // somebody to write a title first and then refusing them the permission is two round trips for
  // one answer.
  const refusal = $derived(
    standingRefusal ??
      (title.trim() === "" ? "A task says what is to be done. Write that first." : undefined),
  );

  function nameOf(userId: string): string {
    return assignableMembers.find((member) => member.userId === userId)?.displayName ?? "Not recorded";
  }

  function reset(): void {
    title = "";
    body = "";
    priority = "normal";
    dueOn = "";
    dueAtTime = "";
    assignee = "";
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    const named = title.trim();
    if (named === "" || standingRefusal !== undefined) return "refused";
    failure = null;
    const scheduled =
      dueOn.trim() === ""
        ? { dueOn: null, dueAtTime: null, timeZone: null }
        : {
            dueOn,
            dueAtTime: dueAtTime.trim() === "" ? null : dueAtTime,
            timeZone: viewerTimeZone(),
          };
    // A retried commit must not leave two tasks behind for one act, so every attempt names itself
    // and the server answers the repeat with the first result.
    const outcome = await createTask(
      fetch,
      {
        matterId,
        title: named,
        body: body.trim() === "" ? null : body.trim(),
        priority,
        assigneeUserId: assignee === "" ? null : assignee,
        ...scheduled,
      },
      newWriteKey(),
    );
    if (outcome.kind === "ok") {
      onCreated();
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The task was not created.",
      "Nothing answered. Nothing was created, so pressing again adds one task.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="New Task"
  subtitle={matterTitle ?? "The firm's own work, on no matter."}
  commitLabel="Create Task"
  commitBusyLabel="Creating"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Task Was Not Created"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy }: { busy: boolean })}
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Label for="{identity}-title">What to do</Label>
        <Input id="{identity}-title" disabled={busy} bind:value={title} />
      </div>

      <div class="flex flex-col gap-8">
        <Label for="{identity}-body">Detail</Label>
        <Textarea id="{identity}-body" rows={3} disabled={busy} bind:value={body} />
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <DatePicker
            label="Due"
            value={civilDateValue(dueOn)}
            onValueChange={(next) => (dueOn = civilDateTextOrEmpty(next))}
            disabled={busy}
          />
        </div>
        <div class="flex flex-col gap-8">
          <Label for="{identity}-due-at-time">Time</Label>
          <Input
            id="{identity}-due-at-time"
            type="time"
            disabled={busy || dueOn === ""}
            bind:value={dueAtTime}
          />
        </div>
      </div>

      <div class="grid gap-16 sm:grid-cols-2">
        <div class="flex flex-col gap-8">
          <Label for="{identity}-priority">Priority</Label>
          <Select.Root type="single" bind:value={priority} disabled={busy}>
            <Select.Trigger id="{identity}-priority">
              {PRIORITY_LABELS[priority]}
            </Select.Trigger>
            <Select.Content>
              {#each TASK_PRIORITIES as candidate (candidate)}
                <Select.Item value={candidate} label={PRIORITY_LABELS[candidate]} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        {#if canAssign}
          <div class="flex flex-col gap-8">
            <Label for="{identity}-assignee">Assign to</Label>
            <Select.Root type="single" bind:value={assignee} disabled={busy}>
              <Select.Trigger id="{identity}-assignee">
                {assignee === "" ? "Nobody yet" : nameOf(assignee)}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="" label="Nobody yet" />
                {#each assignableMembers as member (member.userId)}
                  <Select.Item value={member.userId} label={member.displayName} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
      </div>

      <!-- Whose name goes on it as its author: stated rather than asked, because it is not the
           writer's to choose, and a task whose author only appears after it is stored is a fact the
           person entering it never saw. -->
      <dl class="flex gap-4 text-xs">
        <dt class="text-text-muted">Created by</dt>
        <dd>{authorName}</dd>
      </dl>
    </div>
  {/snippet}
</ActionDialog>
