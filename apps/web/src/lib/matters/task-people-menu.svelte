<script lang="ts">
  /*
   * Choosing who a task is with: its assignees (people and teams) or its watchers (people).
   *
   * Each tick is the change, written as it is made, because the task window and the list edit in
   * place and a second Save for a list of names would be a mode nobody asked for. A new task holds
   * the choice until the task itself is saved.
   */
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import Users from "@lucide/svelte/icons/users";
  import type { FirmMemberSummary } from "$lib/members/members-api.ts";
  import type { AssigneeInput, TaskTeam } from "./tasks-api.ts";

  let {
    label,
    chosen,
    members,
    teams = [],
    disabled = false,
    disabledReason,
    summary,
    onchange,
  }: {
    /** Names the control and heads its menu: "Assigned To", "Watchers". */
    label: string;
    chosen: readonly AssigneeInput[];
    members: readonly FirmMemberSummary[];
    /** Offered only where a team can be chosen, which is assignment and not watching. */
    teams?: readonly TaskTeam[];
    disabled?: boolean;
    disabledReason?: string;
    /** Who is chosen, as words, read on the trigger in place of the label where a row has no room
     * for both: the add row's Assigned To cell. The menu is still headed by the label. */
    summary?: string;
    onchange: (next: AssigneeInput[]) => void;
  } = $props();

  function holdsUser(userId: string): boolean {
    return chosen.some((entry) => "userId" in entry && entry.userId === userId);
  }

  function holdsTeam(teamId: string): boolean {
    return chosen.some((entry) => "teamId" in entry && entry.teamId === teamId);
  }

  function toggle(entry: AssigneeInput, on: boolean): void {
    const same = (candidate: AssigneeInput): boolean =>
      "userId" in entry
        ? "userId" in candidate && candidate.userId === entry.userId
        : "teamId" in candidate && candidate.teamId === entry.teamId;
    onchange(on ? [...chosen.filter((candidate) => !same(candidate)), entry] : chosen.filter((candidate) => !same(candidate)));
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    {disabled}
    class={summary === undefined
      ? buttonClasses({ variant: "secondary", size: "sm" })
      : `${buttonClasses({ variant: "ghost", size: "sm" })} min-w-0 px-4 font-normal`}
    title={disabled ? disabledReason : `Choose ${label.toLowerCase()}`}
    aria-label={summary === undefined ? undefined : `${label}: ${summary}. Change it`}
  >
    <Users aria-hidden="true" />
    {#if summary === undefined}
      {label}
    {:else}
      <span class="truncate">{summary}</span>
    {/if}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="mc-scrollbar max-h-96 overflow-y-auto">
    {#if teams.length > 0}
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>Teams</DropdownMenu.GroupHeading>
        {#each teams as team (team.id)}
          <DropdownMenu.CheckboxItem
            checked={holdsTeam(team.id)}
            closeOnSelect={false}
            onCheckedChange={(on) => toggle({ teamId: team.id }, on === true)}
          >
            {team.name}
          </DropdownMenu.CheckboxItem>
        {/each}
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Group>
      <DropdownMenu.GroupHeading>People</DropdownMenu.GroupHeading>
      {#each members as member (member.userId)}
        <DropdownMenu.CheckboxItem
          checked={holdsUser(member.userId)}
          closeOnSelect={false}
          onCheckedChange={(on) => toggle({ userId: member.userId }, on === true)}
        >
          {member.displayName}
        </DropdownMenu.CheckboxItem>
      {/each}
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>
