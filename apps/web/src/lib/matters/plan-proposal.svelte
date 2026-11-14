<script lang="ts">
  /*
   * THE REVIEW. What a plan would put on this matter, before any of it exists.
   *
   * Every line arrives ticked and editable, because the review is not a confirmation dialog — it is
   * the step where the three things a template cannot know get fixed:
   *
   *   - A DATE THE TEMPLATE COULD NOT KNOW WAS A SUNDAY. The offset is plain calendar days, with no
   *     weekend skip and no holiday calendar, deliberately: deriving a date from a rule is the
   *     docketing engine this platform refuses to build. So the date is shown, flagged where it
   *     falls on a weekend, and editable.
   *   - A ROLE THAT MATCHED NOBODY. It arrives named rather than blank, so the reviewer sees WHICH
   *     role could not be filled instead of an unexplained empty seat, and can fill it here.
   *   - A STEP THIS MATTER DOES NOT NEED. Untick it and it is never created.
   *
   * Nothing on this screen has been written. Closing it writes nothing; that is what declining is.
   */
  import { untrack } from "svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleDate } from "@magna-carta/design-system/loading-fixtures";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    acceptPlan,
    describeAnchor,
    proposePlan,
    type AcceptedPlanTask,
    type PlanProposal,
    type ProposedPlanTask,
  } from "$lib/matters/matter-plans-api.ts";
  import { PRIORITY_LABELS, newWriteKey } from "$lib/matters/tasks-api.ts";
  import { FirmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { DatePicker } from "@magna-carta/design-system/date-picker";
  import { civilDateTextOrEmpty, civilDateValue } from "$lib/dates";

  interface Props {
    matterId: string;
    planId: string;
    planName: string;
    /** Called after the tasks land, so the list behind this refreshes. */
    onAccepted: () => void;
    onDismiss: () => void;
  }

  let { matterId, planId, planName, onAccepted, onDismiss }: Props = $props();

  const roster = new FirmRoster();

  let proposal = $state<PlanProposal | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let writeFailure = $state<StatedFailure | null>(null);
  let saving = $state(false);

  // What the reviewer has done to each line. Keyed by template step, because that is what the
  // acceptance names — the tasks themselves do not exist yet and have no handles.
  let kept = $state<Record<string, boolean>>({});
  let dates = $state<Record<string, string>>({});
  let assignees = $state<Record<string, string>>({});

  $effect(() => {
    const matter = matterId;
    const plan = planId;
    untrack(() => void read(matter, plan));
  });

  /** Read what the plan would put on the matter; Retry asks the same question again. */
  async function read(matter: string, plan: string): Promise<void> {
    proposal = null;
    readFailure = null;
    void roster.load(fetch);
    const outcome = await proposePlan(fetch, matter, plan);
    if (matter !== matterId || plan !== planId) return;
    if (outcome.kind !== "ok") {
      readFailure = stated(outcome.failure, "This plan could not be read.");
      return;
    }
    proposal = outcome.value;
    // Everything starts kept. A review that began with nothing selected would make accepting the
    // whole plan the most laborious path, which is backwards: the plan is usually right.
    kept = Object.fromEntries(outcome.value.tasks.map((task) => [task.taskTemplateId, true]));
    dates = Object.fromEntries(
      outcome.value.tasks.map((task) => [task.taskTemplateId, task.dueOn ?? ""]),
    );
    assignees = Object.fromEntries(
      outcome.value.tasks.map((task) => [task.taskTemplateId, task.assigneeUserId ?? ""]),
    );
  }

  const activeMembers = $derived(
    (roster.members ?? []).filter((member) => member.status === "active"),
  );

  function nameOf(userId: string): string {
    return (
      (roster.members ?? []).find((member) => member.userId === userId)?.displayName ??
      "Not recorded"
    );
  }

  const keptCount = $derived(Object.values(kept).filter(Boolean).length);

  // A date that falls on a Saturday or Sunday. The offset cannot know — it counts calendar days —
  // so the review is where somebody notices.
  function fallsOnAWeekend(date: string): boolean {
    if (date === "") return false;
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
  }

  async function accept(): Promise<void> {
    const current = proposal;
    if (current === null || saving || keptCount === 0) return;
    saving = true;
    writeFailure = null;
    const accepted: AcceptedPlanTask[] = current.tasks
      .filter((task) => kept[task.taskTemplateId])
      .map((task) => {
        const date = dates[task.taskTemplateId] ?? "";
        const assignee = assignees[task.taskTemplateId] ?? "";
        return {
          taskTemplateId: task.taskTemplateId,
          dueOn: date === "" ? null : date,
          // A date needs the zone it is read in; the proposal already resolved the matter's, and a
          // date the reviewer typed takes the same one.
          timeZone: date === "" ? null : (task.timeZone ?? undefined),
          assigneeUserId: assignee === "" ? null : assignee,
        };
      });
    const outcome = await acceptPlan(fetch, matterId, planId, accepted, newWriteKey());
    saving = false;
    if (outcome.kind === "ok") {
      onAccepted();
      return;
    }
    writeFailure = stated(outcome.failure, "The plan was not added to this matter.");
  }

  // The shape drawn while the proposal is read: three lines in the review's own row, ticked, with
  // the anchor sentence beneath each. Sample words only: the dates are the sample vocabulary's,
  // the step titles are the plan's own kind of words, which it does not carry.
  const PROPOSAL_FIXTURE = [
    { title: "Send the engagement letter", due: `Due ${sampleDate(0)}, 14 days after the matter opens` },
    { title: "Calendar the response date", due: "No date proposed" },
    { title: "Open the trust ledger", due: `Due ${sampleDate(3)}, 21 days after the matter opens` },
  ];
</script>

<section class="flex flex-col gap-16 rounded-md border border-border-strong p-16">
  <div class="flex flex-wrap items-baseline justify-between gap-8">
    <div class="flex flex-col gap-2">
      <h3 class="text-sm">{planName}</h3>
      <p class="text-xs text-text-muted">
        Nothing here exists yet. Untick anything this matter does not need, fix any date or name, then
        add what is left.
      </p>
    </div>
    <Button variant="ghost" disabled={saving} onclick={onDismiss}>Not now</Button>
  </div>

  <LoadingRegion
    loading={proposal === null}
    failed={readFailure !== null}
    label="Reading what this plan would add"
    onRetry={() => void read(matterId, planId)}
    class="flex flex-col gap-16"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="Plan Unavailable"
          fallback={readFailure.fallback}
          onRetry={() => void read(matterId, planId)}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      <ul class="flex flex-col gap-8">
        {#each PROPOSAL_FIXTURE as step (step.title)}
          <li class="flex flex-col gap-8 rounded-md border border-border-subtle p-12">
            <div class="flex items-start gap-8">
              <Checkbox checked={true} />
              <div class="flex min-w-0 flex-col gap-2">
                <span>{step.title}</span>
                <div class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
                  <span>{step.due}</span>
                </div>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/snippet}
    {#if proposal !== null}
      {#if writeFailure !== null}
        <FailureNotice
          failure={writeFailure.failure}
          title="Nothing Was Added"
          fallback={writeFailure.fallback}
        />
      {/if}

      {#if proposal.anchorUnavailable}
        <Alert.Root variant="warning">
          <Alert.Title>This Matter Has No Opened Date</Alert.Title>
          <Alert.Description>
            Steps counted from the day the matter opens have no date yet. Give each one a date here, or set the matter's opened date first.
          </Alert.Description>
        </Alert.Root>
      {/if}

      <ul class="flex flex-col gap-8">
        {#each proposal.tasks as task (task.taskTemplateId)}
          {@const isKept = kept[task.taskTemplateId] === true}
          {@const date = dates[task.taskTemplateId] ?? ""}
          <li class="flex flex-col gap-8 rounded-md border border-border-subtle p-12">
            <div class="flex items-start gap-8">
              <Checkbox
                checked={isKept}
                disabled={saving}
                aria-label={`Include "${task.title}"`}
                onCheckedChange={(value) => (kept[task.taskTemplateId] = value === true)}
              />
              <div class="flex min-w-0 flex-col gap-2">
                <span class={isKept ? "" : "text-text-muted line-through"}>{task.title}</span>
                {#if task.body !== null}
                  <p class="text-xs text-text-muted whitespace-pre-wrap">{task.body}</p>
                {/if}
                <div class="flex flex-wrap items-center gap-8 text-xs text-text-muted">
                  <span>{describeAnchor(task)}</span>
                  {#if task.priority !== "normal"}
                    <Badge variant={task.priority === "urgent" ? "danger" : "neutral"}>
                      {PRIORITY_LABELS[task.priority]}
                    </Badge>
                  {/if}
                  {#if task.blockedByTemplateTaskId !== null}
                    <Badge variant="neutral">Waits on an earlier step</Badge>
                  {/if}
                </div>
              </div>
            </div>

            {#if isKept}
              <div class="flex flex-wrap items-end gap-16 pl-24">
                <div class="flex flex-col gap-4">
                  <DatePicker
                    label="Due"
                    value={civilDateValue(dates[task.taskTemplateId])}
                    onValueChange={(next) =>
                      (dates[task.taskTemplateId] = civilDateTextOrEmpty(next))}
                    disabled={saving}
                  />
                </div>
                <div class="flex flex-col gap-4">
                  <Label for={`plan-assignee-${task.taskTemplateId}`}>Assigned to</Label>
                  <Select.Root
                    type="single"
                    bind:value={assignees[task.taskTemplateId]}
                    disabled={saving}
                  >
                    <Select.Trigger id={`plan-assignee-${task.taskTemplateId}`} class="w-192">
                      {assignees[task.taskTemplateId] === ""
                        ? "Nobody yet"
                        : nameOf(assignees[task.taskTemplateId] ?? "")}
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="" label="Nobody yet" />
                      {#each activeMembers as member (member.userId)}
                        <Select.Item value={member.userId} label={member.displayName} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <!-- The template names a role and the platform resolved it. Where it matched nobody the
                     role is still shown, so the gap is explained rather than blank. -->
                {#if task.defaultAssigneeRole !== null && task.assigneeUserId === null}
                  <p class="text-xs text-text-muted">
                    The plan gives this to <strong>{task.defaultAssigneeRole}</strong>, and nobody holds
                    that role on this matter.
                  </p>
                {/if}
                {#if fallsOnAWeekend(date)}
                  <p class="text-xs text-text-muted">
                    That date is a weekend. Plan dates are counted in plain days, so nothing moved it.
                  </p>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      <div class="flex items-center justify-between gap-16">
        <span class="text-xs text-text-muted">
          {keptCount === 0
            ? "Nothing is ticked, so nothing will be added."
            : `${String(keptCount)} of ${String(proposal.tasks.length)} will be added to this matter.`}
        </span>
        <div class="flex gap-8">
          <Button variant="secondary" disabled={saving} onclick={onDismiss}>Cancel</Button>
          <Button disabled={saving || keptCount === 0} onclick={accept}>
            Add {keptCount === 1 ? "1 Task" : `${String(keptCount)} Tasks`}
          </Button>
        </div>
      </div>
    {/if}
  </LoadingRegion>
</section>
