<script lang="ts">
  /*
   * Settings · Firm Profile — what the firm is called to its clients, under Firm.
   *
   * LIVE. The name reaches invoices, the client portal and every generated document; documents
   * already produced keep the name they were produced under, which is the sentence the page says
   * out loud rather than leaving somebody to find out.
   *
   * THE READ IS THE SESSION, not an endpoint of this page's own. Every request already resolves the
   * firm's display name — the bootstrap returns it — so asking a second time would give a screen
   * two answers to reconcile. After a save the session is re-read rather than patched locally,
   * because the name is on the chrome around this page too.
   *
   * ONE FIELD, AND THE REST OF "IDENTITY" IS SOMEWHERE ELSE ON PURPOSE. An address, a telephone
   * number and a letterhead root belong to an OFFICE — the firm has one per location and they are
   * what a document actually prints — so they live under Offices behind locations:manage rather
   * than being copied here into a second, firm-wide answer that no letterhead reads.
   *
   * INSTANT WITH ITS OWN SAVE, not the shared draft footer: it is one field, its own Save is the
   * whole ceremony a single name change deserves, and the footer's staged-count-and-recap anatomy
   * over one row would be more machinery than the act. The masthead states the posture.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
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
      Identity facts about the firm that flow into invoices, the client portal, and generated
      documents.
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
  </div>
</div>
