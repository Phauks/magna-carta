<script lang="ts">
  /*
   * THE PEOPLE ON A TASK, as the window reads and changes them.
   *
   * FOUR SEATS, EACH HOLDING ANY NUMBER OF PEOPLE: who is responsible for the work, who is assigned
   * to do it, who reviews it before it counts, and who watches it. A person holds one seat on one
   * task — somebody who both does the work and reviews it is somebody doing the work — so a person
   * already seated is not offered again, and moving them is taking them off one seat and putting
   * them on another.
   *
   * THE FIELD STAYS READY FOR THE NEXT COLLEAGUE after each pick, and everybody chosen sits beneath
   * it as their own control that takes them back off — the new-matter dialog's shape for a seat
   * that collects people, reused rather than restated.
   *
   * WHAT A MEMBER WITHOUT THE ASSIGN PERMISSION MAY DO is exactly what the server allows and no
   * less: take a work seat themselves, and add or remove watchers. So a work seat's picker offers
   * them only themselves, and a colleague already seated in a work role renders as a fact rather
   * than a chip they could press — the control that refuses is absent, and the sentence beneath
   * the seats says why.
   *
   * READ MODE IS THE SAME ROWS WITHOUT THE PICKERS, so a reader pressing Edit does not lose their
   * place. A seat nobody holds is stated as such rather than omitted: an empty Assigned seat is a
   * fact about the task, and hiding it would make a backlog line look like a task with people on it.
   */
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import X from "@lucide/svelte/icons/x";
  import MemberPicker from "$lib/matters/member-picker.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import {
    ROLE_DESCRIPTIONS,
    ROLE_LABELS,
    TASK_PARTICIPANT_ROLES,
    TASK_WORK_ROLES,
    type TaskParticipantInput,
    type TaskParticipantRole,
  } from "$lib/matters/tasks-api.ts";

  let {
    participants = $bindable([]),
    editing,
    members,
    nameOf,
    canAssign,
    selfUserId,
    disabled = false,
    idPrefix,
  }: {
    /** Everybody on the task, each in one role. Bindable: the window saves what this holds. */
    participants?: TaskParticipantInput[];
    /** Whether the seats are open for change, or stated. */
    editing: boolean;
    /** The firm's roster. Departed members are filtered by the picker, not here. */
    members: readonly FirmMemberSummary[];
    /** How an account identifier reads as a person. */
    nameOf: (userId: string | null) => string;
    /** Whether this account may put work in somebody else's name. */
    canAssign: boolean;
    /** Who is reading, so the one seat they may always take is offered without the permission. */
    selfUserId: string | null;
    disabled?: boolean;
    /** Prefix for the field ids, so two windows on one page never share one. */
    idPrefix: string;
  } = $props();

  const seated = $derived(participants.map((participant) => participant.userId));

  // The one sentence the product uses for a refused capability: what was attempted, and the key an
  // administrator would grant.
  const ASSIGN_REFUSAL = permissionRefusal(
    "Putting a task in another member's name, or taking it out of theirs,",
    "tasks:assign",
  );

  function held(role: TaskParticipantRole): string[] {
    return participants
      .filter((participant) => participant.role === role)
      .map((participant) => participant.userId);
  }

  function isWorkRole(role: TaskParticipantRole): boolean {
    return (TASK_WORK_ROLES as readonly string[]).includes(role);
  }

  /** Whether this account may put THIS person on or off THIS seat. */
  function mayChange(userId: string, role: TaskParticipantRole): boolean {
    return canAssign || !isWorkRole(role) || userId === selfUserId;
  }

  /** Who a seat's picker offers: the roster, or only the reader where the seat is not theirs to fill. */
  function offered(role: TaskParticipantRole): readonly FirmMemberSummary[] {
    if (canAssign || !isWorkRole(role)) return members;
    return members.filter((member) => member.userId === selfUserId);
  }

  function seat(userId: string, role: TaskParticipantRole): void {
    if (seated.includes(userId)) return;
    participants = [...participants, { userId, role }];
  }

  function release(userId: string): void {
    participants = participants.filter((participant) => participant.userId !== userId);
  }

  // The plural, for the seats that read naturally as a group of people rather than one.
  const SEAT_LABELS: Readonly<Record<TaskParticipantRole, string>> = {
    responsible: ROLE_LABELS.responsible,
    assigned: `${ROLE_LABELS.assigned} to`,
    reviewer: "Reviewers",
    watcher: "Watchers",
  };
</script>

{#if editing}
  <div class="grid gap-16 @md:grid-cols-2">
    {#each TASK_PARTICIPANT_ROLES as role (role)}
      {@const holders = held(role)}
      <div class="flex flex-col gap-8">
        <Label for="{idPrefix}-{role}" title={ROLE_DESCRIPTIONS[role]}>{SEAT_LABELS[role]}</Label>
        <MemberPicker
          members={offered(role)}
          exclude={seated}
          onpick={(memberId) => seat(memberId, role)}
          inputId="{idPrefix}-{role}"
          label={SEAT_LABELS[role]}
          {disabled}
        />
        {#if holders.length > 0}
          <ul class="flex flex-wrap gap-4">
            {#each holders as userId (userId)}
              <li>
                {#if mayChange(userId, role)}
                  <Button
                    variant="secondary"
                    size="sm"
                    {disabled}
                    aria-label="Take {nameOf(userId)} off this task"
                    onclick={() => release(userId)}
                  >
                    {nameOf(userId)}
                    <X class="size-16" aria-hidden="true" />
                  </Button>
                {:else}
                  <!-- Somebody this account may not take off the task: stated, not offered. -->
                  <span
                    class="inline-flex items-center rounded-md border border-border-subtle px-8 py-4 text-sm"
                    title={ASSIGN_REFUSAL}
                  >
                    {nameOf(userId)}
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  </div>
  {#if !canAssign}
    <p class="text-xs text-text-muted">
      {ASSIGN_REFUSAL} You can still take a task yourself and add anyone as a watcher.
    </p>
  {/if}
{:else}
  <dl class="grid gap-x-24 gap-y-8 @md:grid-cols-2">
    {#each TASK_PARTICIPANT_ROLES as role (role)}
      {@const holders = held(role)}
      <!-- Assigned is always stated, because an empty seat there is the fact "nobody has picked
           this up". The other three appear only where somebody holds them. -->
      {#if holders.length > 0 || role === "assigned"}
        <div class="flex flex-col gap-4">
          <dt class="text-xs text-text-muted" title={ROLE_DESCRIPTIONS[role]}>{SEAT_LABELS[role]}</dt>
          <dd class="text-sm">
            {holders.length === 0 ? "Nobody yet" : holders.map(nameOf).join(", ")}
          </dd>
        </div>
      {/if}
    {/each}
  </dl>
{/if}
