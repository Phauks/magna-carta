<script lang="ts">
  /*
   * Settings · Roles and Permissions — what each of the firm's roles actually allows, under Firm.
   *
   * A REFERENCE, not a form. Granting a role is done on the Users page, one member at a time; the
   * question this page answers is the one asked immediately before that — "what am I about to give
   * this person" — which a role NAME cannot answer. Read-only in this slice: authoring a role is a
   * separate act with its own consequences (a role is held by several people at once, so editing
   * one changes what a group may do without any of them appearing in the change), and the schema
   * behind it exists whether or not the surface does.
   *
   * The permission key is shown beside the words, always. A person deciding who may move client
   * money should be able to see exactly which capability they are handing over, and a humanized
   * phrase is a summary of a key rather than a replacement for one.
   *
   * A sub-role (Partner, Associate) is listed straight after the role it sits under, indented, and
   * lists only what it ADDS: a member who holds it also holds the parent, so the parent's list is
   * the rest of what they may do. Its line says so, rather than repeating the parent's keys and
   * leaving the reader to work out which ones are the difference.
   */
  import * as Accordion from "@magna-carta/design-system/accordion";
  import Badge from "@magna-carta/design-system/badge";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import type { Failure } from "$lib/api/request.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { listFirmRoles, type FirmRole } from "$lib/members/members-api.ts";
  import { permissionActionPhrase, permissionsByArea } from "$lib/members/permission-language.ts";
  import { orderRolesByFamily } from "$lib/members/role-families.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";

  let roles = $state<readonly FirmRole[] | null>(null);
  let readFailure = $state<Failure | null>(null);
  let reading = $state(false);

  async function load(): Promise<void> {
    readFailure = null;
    reading = true;
    const outcome = await listFirmRoles(fetch);
    reading = false;
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    roles = outcome.value.data;
  }

  $effect(() => {
    void load();
  });

  function memberLine(role: FirmRole): string {
    if (role.memberCount === 0) return "Nobody holds this";
    return role.memberCount === 1 ? "1 member" : `${role.memberCount} members`;
  }

  function permissionLine(role: FirmRole, parent: FirmRole | null): string {
    const count = role.permissions.length;
    if (parent !== null) return `${parent.name} + ${count}`;
    return count === 1 ? "1 permission" : `${count} permissions`;
  }
</script>

<svelte:head>
  <title>Roles and Permissions · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead sectionId="roles" title="Roles and Permissions" posture="readOnly" showHistory={false} />

<SettingsScrollRegion>
    <SettingsDescription>
      What each role allows. A member holds any number of roles and can do what any of them allows.
      A sub-role adds to the role it sits under. Roles are given to people under Users.
    </SettingsDescription>

    <SettingsPlate heading="The Firm's Roles">
      <LoadingRegion
        loading={roles === null}
        failed={readFailure !== null && roles === null}
        refreshing={reading}
        empty={roles !== null && roles.length === 0}
        label="Reading the firm's roles"
        onRetry={() => void load()}
        class="flex flex-col"
      >
        {#snippet failure()}
          {#if readFailure !== null}
            <FailureNotice
              failure={readFailure}
              title="The Roles Could Not Be Read"
              fallback="The firm's roles were not read."
              onRetry={() => void load()}
            />
          {/if}
        {/snippet}
        {#snippet emptyState()}
          <EmptyState title="No roles">
            A firm is created with its default roles. This one has none, which means nobody can be given
            anything — an administrator should be asked to look at it.
          </EmptyState>
        {/snippet}
        {@const shown = orderRolesByFamily(roles ?? [])}
        <Accordion.Root type="multiple" class="flex flex-col">
          {#each shown as { role, parent } (role.id)}
            <Accordion.Item value={role.id} class={parent === null ? undefined : "ps-24"}>
              <Accordion.Trigger>
                <span class="flex min-w-0 flex-col gap-4 text-start">
                  <span class="flex flex-wrap items-center gap-8">
                    <span>{role.name}</span>
                    {#if parent !== null}
                      <Badge variant="neutral">Sub-role of {parent.name}</Badge>
                    {:else if role.permissions.length === 0}
                      <Badge variant="warning">Allows nothing</Badge>
                    {/if}
                  </span>
                  <span class="text-xs text-text-muted">
                    {memberLine(role)} · {permissionLine(role, parent)}
                  </span>
                </span>
              </Accordion.Trigger>
              <Accordion.Content>
                {#if parent !== null}
                  <p class="mb-12 text-sm text-text-muted">
                    Includes everything {parent.name} allows. Whoever holds {role.name} also holds
                    {parent.name}, and the list below is what {role.name} adds.
                  </p>
                {/if}
                {#if role.permissions.length === 0}
                  <p class="text-sm text-text-muted">
                    {parent === null
                      ? "This role carries no permissions, so holding it allows nothing at all."
                      : `${role.name} adds nothing to ${parent.name} yet.`}
                  </p>
                {:else}
                  <div class="flex flex-col gap-12">
                    {#each permissionsByArea(role.permissions) as area (area.name)}
                      <div class="flex flex-col gap-4">
                        <FieldLabel>{area.name}</FieldLabel>
                        <ul class="flex flex-col gap-2">
                          {#each area.permissions as permission (permission)}
                            <li class="flex items-baseline justify-between gap-16 text-sm">
                              <span class="text-text">{permissionActionPhrase(permission)}</span>
                              <code class="text-xs text-text-muted">{permission}</code>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/each}
                  </div>
                {/if}
              </Accordion.Content>
            </Accordion.Item>
          {/each}
        </Accordion.Root>
      </LoadingRegion>
    </SettingsPlate>
</SettingsScrollRegion>
