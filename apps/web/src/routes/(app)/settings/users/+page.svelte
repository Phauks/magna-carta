<script lang="ts">
  /*
   * Settings · Users — the firm administering its members, under Firm.
   *
   * THE OWNER-SETTLED BOUNDARY: this page is the firm managing its members — "us" (invitations,
   * roles, deactivation). A member's OWN identity and credentials (profile, password, 2FA,
   * sessions) live in the separate Account Settings surface reached from the profile menu —
   * "me" — and the two are never mixed.
   *
   * A CATALOG page, not a settings form, on the Rooms and Resources pattern: inviting somebody,
   * changing what they hold and taking their access away are each an act asked for in its own
   * dialog and committed at once, so the posture is "applies immediately" and nothing is staged.
   * A roster is a list of people the firm acts on one at a time, and staging a batch of them
   * behind one Save would make "who works here" a document with a draft.
   *
   * THE ROSTER IS THE PRODUCT'S ONE TABLE (catalog-columns.ts declares its columns): it sorts,
   * filters from its headers, offers its column roster, resizes and counts itself. The grid is
   * re-created when the session lands, because the Actions column exists only for a member who
   * may act and the grid fixes its columns when it is made.
   *
   * TWO REFUSALS COME FROM THE SERVER AND ARE SHOWN, NOT PREDICTED. A member cannot administer
   * themselves, and the firm must keep somebody who can administer it — the acting member's own
   * row therefore offers no actions, which is the honest half this page CAN know. Whether a
   * change would strand the firm depends on every other member's roles at the instant it lands,
   * so that one is asked of the server and its answer rendered.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    inviteMember,
    listFirmMembers,
    listFirmRoles,
    MANAGE_MEMBERS_PERMISSION,
    setMemberActive,
    setMemberRoles,
    type FirmMemberSummary,
    type FirmRole,
  } from "$lib/members/members-api.ts";
  import { orderRolesByFamily, toggleRoleInFamily } from "$lib/members/role-families.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import {
    CATALOG_ACTIONS_COLUMN_ID,
    memberColumns,
    memberStandingKey,
  } from "$lib/settings/catalog-columns.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  let session = $state<SessionBootstrap | null>(null);
  const canEdit = $derived(session?.permissions.includes(MANAGE_MEMBERS_PERMISSION) ?? false);
  /** The acting member, so their own row can say why it offers nothing. */
  const actingUserId = $derived(session?.user.id ?? null);

  let members = $state<readonly FirmMemberSummary[] | null>(null);
  let roles = $state<readonly FirmRole[]>([]);
  let readFailure = $state<Failure | null>(null);
  let actionFailure = $state<StatedFailure | null>(null);

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await listFirmMembers(fetch);
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    members = outcome.value.data;
  }

  $effect(() => {
    void load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
    // The roles read is separate and its failure is quiet: the roster is this page's subject, and
    // a roster that renders without the role catalog still answers who is here. What it cannot do
    // without it is offer a role, so the dialogs say so rather than opening onto an empty list.
    void listFirmRoles(fetch).then((outcome) => {
      if (outcome.kind === "ok") roles = outcome.value.data;
    });
  });

  const grid = $derived(
    DataTable.createDataTableGrid<FirmMemberSummary>({
      columns: () => memberColumns(canEdit),
      rows: () => members ?? [],
      rowKey: (member) => member.userId,
      itemNoun: { singular: "member", plural: "members" },
    }),
  );

  function roleName(roleId: string): string {
    return roles.find((role) => role.id === roleId)?.name ?? roleId;
  }

  // ---- inviting somebody ------------------------------------------------------------------------

  /** "No role" is a real choice, so the field offers it as a row; the invitation sends null for it. */
  const NO_ROLE = "no-role";

  let inviteOpen = $state(false);
  let inviteName = $state("");
  let inviteEmail = $state("");
  let inviteRoleName = $state(NO_ROLE);
  let inviteFailure = $state<StatedFailure | null>(null);
  let inviteKey: string | null = null;

  // A sub-role reads with its parent beside it, because inviting somebody as a Partner also makes
  // them an Attorney and the choice should say so before it is made.
  const orderedRoles = $derived(orderRolesByFamily(roles));
  const roleChoices = $derived([
    { value: NO_ROLE, label: "No role" },
    ...orderedRoles.map(({ role, parent }) => ({
      value: role.name,
      label: parent === null ? role.name : `${parent.name}, ${role.name}`,
    })),
  ]);
  const inviteStarted = $derived(
    inviteName.trim() !== "" || inviteEmail.trim() !== "" || inviteRoleName !== NO_ROLE,
  );
  const inviteRefusal = $derived.by((): string | undefined => {
    if (inviteName.trim() === "") return "Give the person a name.";
    // Deliberately the loosest possible shape check. The server holds the real rule, and a
    // client-side address grammar that is stricter than the server's turns a working address into
    // an error nobody can argue with.
    if (!inviteEmail.includes("@")) return "An email address is where the invitation goes.";
    return undefined;
  });

  function openInvite(): void {
    inviteName = "";
    inviteEmail = "";
    inviteRoleName = NO_ROLE;
    inviteFailure = null;
    inviteKey = null;
    inviteOpen = true;
  }

  async function commitInvite(): Promise<ActionOutcome> {
    if (inviteRefusal !== undefined) return "refused";
    inviteFailure = null;
    inviteKey ??= crypto.randomUUID();
    const outcome = await inviteMember(
      fetch,
      {
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        roleName: inviteRoleName === NO_ROLE ? null : inviteRoleName,
      },
      inviteKey,
    );
    if (outcome.kind === "ok") {
      inviteKey = null;
      // The member row is written by the provisioning consumer rather than by the invite itself,
      // so a re-read this instant may not show them yet. The roster is re-read anyway: the row
      // usually lands within the request, and a roster one refresh behind is better than a page
      // that never tries.
      await load();
      return "committed";
    }
    if (outcome.kind === "problem") inviteKey = null;
    inviteFailure = stated(
      outcome.failure,
      "The invitation was not sent.",
      "Nothing answered, so nobody was invited; pressing again tries once more.",
    );
    return "refused";
  }

  // ---- changing what somebody holds -------------------------------------------------------------

  let rolesOpen = $state(false);
  let rolesSubject = $state<FirmMemberSummary | null>(null);
  let chosenRoleIds = $state<string[]>([]);
  let heldRoleIds: string[] = [];
  let rolesFailure = $state<StatedFailure | null>(null);
  let rolesKey: string | null = null;

  const rolesStarted = $derived(
    JSON.stringify(chosenRoleIds.toSorted()) !== JSON.stringify(heldRoleIds.toSorted()),
  );

  function openRoles(member: FirmMemberSummary): void {
    rolesSubject = member;
    // The roster answers role NAMES; the write names handles. Resolving one to the other through
    // the role catalog is what makes the two reads one surface — a name the catalog does not
    // carry is dropped rather than guessed at, which can only happen if the catalog read failed,
    // and the dialog says so in that case.
    heldRoleIds = roles
      .filter((role) => member.roleNames.includes(role.name))
      .map((role) => role.id);
    chosenRoleIds = [...heldRoleIds];
    rolesFailure = null;
    rolesKey = null;
    rolesOpen = true;
  }

  function toggleRole(roleId: string, held: boolean): void {
    chosenRoleIds = toggleRoleInFamily(chosenRoleIds, roleId, held, roles);
  }

  async function commitRoles(): Promise<ActionOutcome> {
    const subject = rolesSubject;
    if (subject === null) return "refused";
    rolesFailure = null;
    rolesKey ??= crypto.randomUUID();
    const outcome = await setMemberRoles(fetch, subject.userId, chosenRoleIds, rolesKey);
    if (outcome.kind === "ok") {
      rolesKey = null;
      await load();
      return "committed";
    }
    if (outcome.kind === "problem") rolesKey = null;
    rolesFailure = stated(
      outcome.failure,
      "The roles were not changed.",
      "Nothing answered, so nothing changed; pressing again tries once more.",
    );
    return "refused";
  }

  // ---- taking access away, and giving it back ---------------------------------------------------

  async function setActive(member: FirmMemberSummary, active: boolean): Promise<void> {
    actionFailure = null;
    const outcome = await setMemberActive(fetch, member.userId, active, crypto.randomUUID());
    if (outcome.kind === "ok") {
      await load();
      return;
    }
    actionFailure = stated(
      outcome.failure,
      active
        ? `${member.displayName} was not brought back.`
        : `${member.displayName}'s access was not withdrawn.`,
    );
  }
</script>

<svelte:head>
  <title>Users · Settings · Magna Carta</title>
</svelte:head>

{#snippet memberCell({ row, column, text }: DataTable.GridCellContext<FirmMemberSummary>)}
  {#if column.id === "roles" && row.roleNames.length === 0}
    <!-- A real state with a real consequence, so it is stated rather than left as an empty cell
         that reads as data still loading. -->
    <Badge variant="warning">{text}</Badge>
  {:else if column.id === "standing"}
    {@const standing = memberStandingKey(row)}
    <Badge {...statusBadgeAttributes(standing)}>{statusEntry(standing).label}</Badge>
  {:else if column.id === CATALOG_ACTIONS_COLUMN_ID}
    {#if row.userId === actingUserId}
      <span class="text-xs text-text-muted">Ask another administrator</span>
    {:else}
      <span class="inline-flex items-center justify-end gap-4">
        <Button variant="ghost" size="sm" onclick={() => openRoles(row)}>Change Roles</Button>
        <Button
          variant="ghost"
          size="sm"
          onclick={() => void setActive(row, row.status !== "active")}
        >
          {row.status === "active" ? "Withdraw Access" : "Restore Access"}
        </Button>
      </span>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

<SettingsMasthead
  sectionId="users"
  title="Users"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The firm's members and what their roles allow. What each role means is listed under Roles and
    Permissions.
  </SettingsDescription>

  {#if actionFailure !== null}
    <FailureNotice failure={actionFailure.failure} fallback={actionFailure.fallback} />
  {/if}

  <SettingsPlate heading="Membership">
    {#if canEdit || grid.isFiltered}
      <div class="flex items-center justify-end gap-8 py-12">
        <DataTable.ClearFilters {grid} />
        {#if canEdit}
          <Button variant="primary" size="sm" onclick={openInvite}>Invite a Member</Button>
        {/if}
      </div>
    {/if}
    {#if readFailure !== null && members === null}
      <FailureNotice
        failure={readFailure}
        title="The Members Could Not Be Read"
        fallback="The firm's member list was not read."
        onRetry={() => void load()}
      />
    {:else}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Members Were Not Re-read"
          fallback="The roster was not read again. What is shown was read and stands."
          onRetry={() => void load()}
        />
      {/if}
      <DataTable.Grid
        {grid}
        caption="The firm's members"
        cell={memberCell}
        loading={members === null}
        placeholderCount={3}
      >
      </DataTable.Grid>
      <DataTable.GridFooter {grid} />
    {/if}
  </SettingsPlate>
</SettingsScrollRegion>

<ActionDialog
  bind:open={inviteOpen}
  heading="Invite a Member"
  commitLabel="Send Invitation"
  commitBusyLabel="Sending"
  commitRefusal={inviteRefusal}
  unsavedChanges={inviteStarted}
  onCommit={commitInvite}
>
  {#snippet notice()}
    {#if inviteFailure !== null}
      <FailureNotice
        failure={inviteFailure.failure}
        fallback={inviteFailure.fallback}
        whenSilent={inviteFailure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      <p class="text-sm text-text-muted">
        They are emailed a link that sets their password. Nothing is reachable to them until they
        follow it.
      </p>
      <div class="flex flex-col gap-4">
        <Label for="invite-name">Name</Label>
        <Input id="invite-name" bind:value={inviteName} />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="invite-email">Email</Label>
        <Input id="invite-email" type="email" bind:value={inviteEmail} />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="invite-role">Role</Label>
        <ChoicePicker
          options={roleChoices}
          inputId="invite-role"
          label="Role"
          bind:value={inviteRoleName}
        />
        <p class="text-xs text-text-muted">
          A member with no role can sign in and reach nothing. The role can be changed at any time.
        </p>
      </div>
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={rolesOpen}
  heading={rolesSubject === null ? "Change Roles" : `Change ${rolesSubject.displayName}'s Roles`}
  commitLabel="Save Roles"
  commitBusyLabel="Saving"
  unsavedChanges={rolesStarted}
  onCommit={commitRoles}
>
  {#snippet notice()}
    {#if rolesFailure !== null}
      <FailureNotice
        failure={rolesFailure.failure}
        fallback={rolesFailure.fallback}
        whenSilent={rolesFailure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-12">
      {#if roles.length === 0}
        <p class="text-sm text-text-muted">
          The firm's roles could not be read, so none can be offered. Close this and try again.
        </p>
      {:else}
        <p class="text-sm text-text-muted">
          A member holds any number of roles and can do what any of them allows. What each one
          means is listed under Roles and Permissions.
        </p>
        {#each orderedRoles as { role, parent } (role.id)}
          {@const held = chosenRoleIds.includes(role.id)}
          <div class={parent === null ? "flex items-center gap-8" : "flex items-center gap-8 ps-24"}>
            <Checkbox
              id={`role-${role.id}`}
              checked={held}
              onCheckedChange={(next) => toggleRole(role.id, next === true)}
            />
            <Label for={`role-${role.id}`}>{role.name}</Label>
            {#if parent !== null}
              <span class="text-xs text-text-muted">a kind of {parent.name}</span>
            {/if}
          </div>
        {/each}
        {#if orderedRoles.some(({ parent }) => parent !== null)}
          <p class="text-xs text-text-muted">
            A sub-role comes with the role it sits under, and a member holds one sub-role of each.
          </p>
        {/if}
      {/if}
      {#if rolesSubject !== null && chosenRoleIds.length === 0}
        <p class="text-sm text-text-muted">
          {rolesSubject.displayName} will hold no role, and will be able to sign in and reach
          nothing.
        </p>
      {/if}
      {#if chosenRoleIds.length > 0}
        <p class="text-xs text-text-muted">
          Holding: {chosenRoleIds.map((roleId) => roleName(roleId)).join(", ")}
        </p>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
