<script lang="ts">
  /*
   * Settings · Firm Profile — what the firm IS, under Firm: its name, its marks, and its offices.
   *
   * THE NAME reaches invoices, the client portal and every generated document; documents already
   * produced keep the name they were produced under, which is the sentence the page says out loud
   * rather than leaving somebody to find out. Its read is the session, not an endpoint of this
   * page's own — every request already resolves the firm's display name — and after a save the
   * session is re-read rather than patched locally, because the name is on the chrome too.
   *
   * THE MARKS are the firm's own: a primary mark, and the images the firm keeps beside it. An
   * office's letterhead prints the primary mark unless that office has set a logo of its own, which
   * is what lets a single-office firm set its identity here once. They live on their own plate,
   * each act committed at once.
   *
   * THE OFFICES are read here and managed on their own screen: an address, a telephone number and
   * a letterhead belong to an office, and a firm has one per place it practises. This page states
   * which offices there are and links to each, so the identity page is complete without repeating
   * the register.
   *
   * INSTANT, WITH ITS OWN SAVE ON THE NAME, not the shared draft footer: the name is one field, and
   * the marks and offices are acts against their own routes. The masthead states the posture.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { firmOffices } from "$lib/offices/firm-offices.svelte.ts";
  import OfficeLink from "$lib/offices/office-link.svelte";
  import { officeStatusKey } from "$lib/offices/office-vocabulary.ts";
  import {
    MANAGE_FIRM_PROFILE_PERMISSION,
    MAX_FIRM_DISPLAY_NAME_LENGTH,
    setFirmProfile,
  } from "$lib/settings/firm-profile-api.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";
  import BrandImagesPlate from "./brand-images-plate.svelte";

  const NAME_DEFINITION: SettingDefinition = {
    id: "firm-profile.display-name",
    sectionId: "firm-profile",
    label: "Firm Name",
    description: "What clients see: on invoices, in the portal, and on generated documents.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
    audited: true,
  };

  const committed = $derived(sessionPermissions.session?.firm?.name ?? null);
  const canEdit = $derived(sessionPermissions.holds(MANAGE_FIRM_PROFILE_PERMISSION));

  let draft = $state("");
  let saving = $state(false);
  let failure = $state<StatedFailure | null>(null);

  $effect(() => {
    void sessionPermissions.load(fetch);
    void firmOffices.load(fetch);
  });

  // Seeded from the session, and re-seeded whenever it answers again — never while somebody types.
  let seeded = $state(false);
  $effect(() => {
    if (committed === null || seeded) return;
    draft = committed;
    seeded = true;
  });

  const trimmed = $derived(draft.trim());
  const changed = $derived(committed !== null && trimmed !== committed);
  const refusal = $derived.by((): string | undefined => {
    if (trimmed === "") return "A firm needs a name: it is what a client reads on every document.";
    if (trimmed.length > MAX_FIRM_DISPLAY_NAME_LENGTH) {
      return `At most ${MAX_FIRM_DISPLAY_NAME_LENGTH} characters.`;
    }
    return undefined;
  });

  function discard(): void {
    draft = committed ?? "";
    failure = null;
  }

  async function save(): Promise<void> {
    if (!changed || refusal !== undefined) return;
    failure = null;
    saving = true;
    const outcome = await setFirmProfile(fetch, trimmed, crypto.randomUUID());
    if (outcome.kind === "ok") {
      // Re-read rather than patch: the firm's name is on the chrome around this page too.
      sessionPermissions.settled = false;
      seeded = false;
      await sessionPermissions.load(fetch);
      saving = false;
      return;
    }
    saving = false;
    failure = stated(
      outcome.failure,
      "The firm's name was not changed.",
      "Nothing answered, so the name is unchanged; pressing Save again tries once more.",
    );
  }

  const offices = $derived(firmOffices.offices);
</script>

<svelte:head>
  <title>Firm Profile · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="firm-profile"
  title="Firm Profile"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<!-- The middle story: the one scroll area, reaching the canvas's true edges (the breathing
     room rides INSIDE it); scrollbar-gutter keeps pages that scroll and pages that do not at
     identical width. -->
<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsDescription>
      Who the firm is: the name its clients read, the marks its documents carry, and the offices
      it practises from.
    </SettingsDescription>

    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}

    <SettingsPlate heading="Identity">
      <LoadingRegion
        loading={committed === null && !sessionPermissions.settled}
        failed={sessionPermissions.settled && committed === null}
        label="Reading the firm's name"
        onRetry={() => void sessionPermissions.load(fetch)}
        class="flex flex-col"
      >
        {#snippet failure()}
          <p class="py-12 text-sm text-text-muted">
            The firm's name could not be read, so it is not shown rather than guessed at.
          </p>
        {/snippet}
        {#snippet fixture()}
          <SettingsRow definition={NAME_DEFINITION} value="" />
        {/snippet}

        {#if canEdit}
          <SettingsRow definition={NAME_DEFINITION}>
            {#snippet control()}
              <Input bind:value={draft} disabled={saving} aria-label="Firm name" />
            {/snippet}
          </SettingsRow>

          <div class="flex items-center justify-end gap-8 py-12">
            {#if changed && refusal !== undefined}
              <span class="me-auto text-sm text-text-muted">{refusal}</span>
            {:else if changed}
              <!-- Said before the change lands, not after: documents already produced are not
                   reprinted, and somebody renaming the firm should know that first. -->
              <span class="me-auto text-sm text-text-muted">
                New documents will carry this name. Documents already produced keep the name they
                were produced under.
              </span>
            {/if}
            <Button variant="secondary" size="sm" disabled={!changed || saving} onclick={discard}>
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!changed || saving || refusal !== undefined}
              onclick={() => void save()}
            >
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        {:else}
          <SettingsRow definition={NAME_DEFINITION} value={committed ?? ""} />
        {/if}
      </LoadingRegion>
    </SettingsPlate>

    <BrandImagesPlate {canEdit} />

    <SettingsPlate heading="Offices">
      <LoadingRegion
        loading={offices === null}
        failed={firmOffices.failure !== null}
        empty={offices !== null && offices.length === 0}
        label="Reading the firm's offices"
        onRetry={() => void firmOffices.reload(fetch)}
        class="flex flex-col"
      >
        {#snippet failure()}
          <p class="py-12 text-sm text-text-muted">{firmOffices.failure}</p>
        {/snippet}
        {#snippet emptyState()}
          <div class="flex flex-col gap-12 py-12">
            <EmptyState title="No offices yet">
              An office carries the firm's address, its telephone and the letterhead its documents
              print on. The first one is opened on the Offices screen.
            </EmptyState>
            <div class="flex justify-end">
              <Button variant="secondary" size="sm" href="/settings/offices">Open the Offices Screen</Button>
            </div>
          </div>
        {/snippet}
        {#snippet fixture()}
          <div class="flex items-center gap-16 py-12">
            <span class="text-md">Downtown</span>
            <span class="text-sm text-text-muted">Reno, NV · RENO</span>
          </div>
        {/snippet}

        {#each offices ?? [] as office (office.id)}
          <div class="flex items-center gap-16 py-12">
            <div class="flex min-w-0 grow flex-col gap-4">
              <span class="text-md">
                <OfficeLink officeId={office.id} name={office.name} />
              </span>
              <span class="text-sm text-text-muted">
                {office.members === 1 ? "1 member" : `${office.members} members`}
                {#if office.email !== null}
                  &middot; {office.email}
                {/if}
              </span>
            </div>
            <span class="flex shrink-0 items-center gap-4">
              {#if office.firmDefault}
                <Badge variant="accent">Firm default</Badge>
              {/if}
              <Badge {...statusBadgeAttributes(officeStatusKey(office.status))}>
                {statusEntry(officeStatusKey(office.status)).label}
              </Badge>
            </span>
          </div>
        {/each}
        {#if (offices ?? []).length > 0}
          <div class="flex items-center justify-end gap-8 py-12">
            <Button variant="secondary" size="sm" href="/settings/offices">Manage Offices</Button>
          </div>
        {/if}
      </LoadingRegion>
    </SettingsPlate>
  </div>
</div>
