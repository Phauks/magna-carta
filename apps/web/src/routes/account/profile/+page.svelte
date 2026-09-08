<script lang="ts">
  /*
   * Account · Profile — the member's identity within Magna Carta.
   *
   * THE NAME IS LIVE. It is read from and written to the account's own record: five parts, and the
   * one line they read as. Email and avatar are still honest Soon seams — both are credential-shaped
   * changes (an address change has to prove the new mailbox; an avatar needs a store that does not
   * exist), and neither is what a person comes to this page to fix.
   *
   * A NAME IS PARTS, NOT A STRING. The parts are what letterhead, a pleading's signature block and
   * every generated document print, and what a roster sorts by. A single string cannot be sorted by
   * surname, cannot address a letter, and cannot be split back into parts afterwards without
   * guessing — "Mary Anne van der Berg III" has no rule that recovers it. So the parts are what is
   * collected, and the display name is composed FROM them rather than typed beside them.
   *
   * WHICH IS WHY THE SPLIT ON THIS PAGE IS A SUGGESTION AND NEVER A SAVE. An account created before
   * the parts existed holds only the one line its owner typed at registration. The form seeds itself
   * from a reading of that line — first word given, last word family — and says so, so the person
   * confirms or corrects their own name before anything is stored. Nothing writes that reading on
   * their behalf: an account created from today carries real parts from registration and never meets
   * this path at all.
   *
   * SAVE IS PER PLATE, not per page. The account surface has no commit footer — that is settings
   * vocabulary — so the Name plate carries its own Save and Discard, the matter-numbering editor's
   * precedent.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { renderPersonName, splitNameForReview } from "@magna-carta/directory/person-name";
  import type { Failure } from "$lib/api/request.ts";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import HonorificField from "$lib/names/honorific-field.svelte";
  import {
    readMemberName,
    writeMemberName,
    type MemberName,
    type MemberNameParts,
  } from "$lib/names/member-name-api.ts";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // Page-local definitions: rendering through SettingsRow keeps the shared table grid. The
  // kind/defaultValue fields are inert here (the control snippet renders instead).
  function nameField(part: string, label: string, description: string): SettingDefinition {
    return {
      id: `account.profile.name.${part}`,
      sectionId: "account-profile",
      label,
      description,
      kind: "text",
      defaultValue: "",
      sensitivity: "open",
    };
  }

  const PREFIX_DEFINITION = nameField(
    "prefix",
    "Prefix",
    "How you are addressed. Several is fine: Hon., Dr. Optional.",
  );
  const FIRST_NAME_DEFINITION = nameField("first", "First Name", "Your given name.");
  const MIDDLE_NAME_DEFINITION = nameField(
    "middle",
    "Middle Name",
    "Your middle name or initial, as it appears on filings. Optional.",
  );
  const LAST_NAME_DEFINITION = nameField(
    "last",
    "Last Name",
    "Your family name — what your colleagues are sorted by.",
  );
  const SUFFIX_DEFINITION = nameField(
    "suffix",
    "Suffix",
    "What follows your name. Several is fine: III, Esq. Optional.",
  );

  const EMAIL_DEFINITION: SettingDefinition = {
    id: "account.profile.email",
    sectionId: "account-profile",
    label: "Email",
    description: "The address you sign in with and receive notices at.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  const AVATAR_DEFINITION: SettingDefinition = {
    id: "account.profile.avatar",
    sectionId: "account-profile",
    label: "Avatar",
    description: "The picture that represents you to your firm.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  // ---- the name, read and edited ---------------------------------------------------------------

  interface NameDraft {
    prefix: string;
    given: string;
    middle: string;
    family: string;
    suffix: string;
  }

  const EMPTY_DRAFT: NameDraft = { prefix: "", given: "", middle: "", family: "", suffix: "" };

  let name = $state<MemberName | null>(null);
  let readFailure = $state<Failure | null>(null);
  let rereading = $state(false);
  let saveFailure = $state<StatedFailure | null>(null);
  let saving = $state(false);
  let draft = $state<NameDraft>({ ...EMPTY_DRAFT });
  let since = $state<NameDraft>({ ...EMPTY_DRAFT });
  /** True while the form is showing a READING of the old single line rather than stored parts. */
  let seededFromReading = $state(false);

  function draftFrom(parts: MemberNameParts): NameDraft {
    return {
      prefix: parts.prefix ?? "",
      given: parts.given ?? "",
      middle: parts.middle ?? "",
      family: parts.family ?? "",
      suffix: parts.suffix ?? "",
    };
  }

  function seed(read: MemberName): void {
    if (read.partsStated) {
      seededFromReading = false;
      draft = draftFrom(read.parts);
      since = draftFrom(read.parts);
      return;
    }
    // No parts on file: offer a reading of the one line the account was created with, and say so.
    // Nothing is stored until the person presses Save on it — `since` stays empty, so the form
    // reads as changed and the reading is something to confirm rather than something already true.
    const guessed = splitNameForReview(read.displayName);
    seededFromReading = true;
    draft = draftFrom({
      prefix: null,
      given: guessed.given ?? null,
      middle: guessed.middle ?? null,
      family: guessed.family ?? null,
      suffix: null,
    });
    since = { ...EMPTY_DRAFT };
  }

  async function load(): Promise<void> {
    readFailure = null;
    rereading = true;
    const outcome = await readMemberName(fetch);
    rereading = false;
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    name = outcome.value;
    seed(outcome.value);
  }

  $effect(() => {
    void load();
  });

  const changed = $derived(JSON.stringify(draft) !== JSON.stringify(since));
  /** What the name will read as once saved — the server's own rule, from the module that holds it. */
  const preview = $derived(
    renderPersonName({
      prefix: draft.prefix,
      given: draft.given,
      middle: draft.middle,
      family: draft.family,
      suffix: draft.suffix,
    }),
  );

  function discard(): void {
    draft = { ...since };
    saveFailure = null;
  }

  async function save(): Promise<void> {
    if (preview === "") return;
    saveFailure = null;
    saving = true;
    const outcome = await writeMemberName(fetch, {
      prefix: draft.prefix.trim() === "" ? null : draft.prefix.trim(),
      given: draft.given.trim() === "" ? null : draft.given.trim(),
      middle: draft.middle.trim() === "" ? null : draft.middle.trim(),
      family: draft.family.trim() === "" ? null : draft.family.trim(),
      suffix: draft.suffix.trim() === "" ? null : draft.suffix.trim(),
    });
    saving = false;
    if (outcome.kind === "ok") {
      name = outcome.value;
      seed(outcome.value);
      return;
    }
    saveFailure = stated(
      outcome.failure,
      "Your name was not saved.",
      "Nothing answered, so nothing changed; pressing Save again tries once more.",
    );
  }
</script>

<svelte:head>
  <title>Profile · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Profile" meta="Your identity within Magna Carta." />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Name">
      <LoadingRegion
        loading={name === null && readFailure === null}
        failed={readFailure !== null && name === null}
        refreshing={rereading && name !== null}
        label="Reading your name"
        onRetry={() => void load()}
        class="flex flex-col"
      >
        {#snippet failure()}
          {#if readFailure !== null}
            <FailureNotice
              failure={readFailure}
              title="Your Name Could Not Be Read"
              fallback="Your account's name was not read."
              onRetry={() => void load()}
            />
          {/if}
        {/snippet}

        {#if seededFromReading && name !== null}
          <p class="py-12 text-sm text-text-muted">
            Your account was created with one name, {name.displayName}. Below is how it reads as
            parts. Check it and press Save, or correct it first — nothing is stored until you do.
          </p>
        {/if}

        {#if saveFailure !== null}
          <FailureNotice
            failure={saveFailure.failure}
            fallback={saveFailure.fallback}
            whenSilent={saveFailure.whenSilent}
          />
        {/if}

        <SettingsRow definition={PREFIX_DEFINITION}>
          {#snippet control()}
            <HonorificField part="prefix" bind:value={draft.prefix} disabled={saving} />
          {/snippet}
        </SettingsRow>

        <SettingsRow definition={FIRST_NAME_DEFINITION}>
          {#snippet control()}
            <Input bind:value={draft.given} disabled={saving} aria-label="First name" />
          {/snippet}
        </SettingsRow>

        <SettingsRow definition={MIDDLE_NAME_DEFINITION}>
          {#snippet control()}
            <Input bind:value={draft.middle} disabled={saving} aria-label="Middle name" />
          {/snippet}
        </SettingsRow>

        <SettingsRow definition={LAST_NAME_DEFINITION}>
          {#snippet control()}
            <Input bind:value={draft.family} disabled={saving} aria-label="Last name" />
          {/snippet}
        </SettingsRow>

        <SettingsRow definition={SUFFIX_DEFINITION}>
          {#snippet control()}
            <HonorificField part="suffix" bind:value={draft.suffix} disabled={saving} />
          {/snippet}
        </SettingsRow>

        <!-- What the parts read as, stated rather than editable: a display name a person can edit
             apart from its parts is a second answer to what they are called. -->
        <div class="flex items-baseline justify-between gap-16 border-t border-border-subtle py-12">
          <span class="text-sm text-text-muted">You will appear as</span>
          <span class="text-sm font-medium">{preview === "" ? "—" : preview}</span>
        </div>

        <div class="flex items-center justify-end gap-8 py-12">
          {#if preview === "" && changed}
            <span class="me-auto text-sm text-text-muted">Give at least one part of your name.</span>
          {/if}
          <Button variant="secondary" size="sm" disabled={!changed || saving} onclick={discard}>
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!changed || saving || preview === ""}
            onclick={() => void save()}
          >
            {saving ? "Saving" : "Save"}
          </Button>
        </div>
      </LoadingRegion>
    </SettingsPlate>

    <SettingsPlate heading="Identity">
      <SettingsRow definition={EMAIL_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Input disabled placeholder="—" aria-label="Email (arrives with authentication)" />
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={AVATAR_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <Avatar.Root>
            <Avatar.Fallback>MC</Avatar.Fallback>
          </Avatar.Root>
          <Button variant="secondary" disabled aria-label="Change avatar (arrives with authentication)"
            >Change…</Button
          >
        {/snippet}
      </SettingsRow>
    </SettingsPlate>
  </div>
</div>
