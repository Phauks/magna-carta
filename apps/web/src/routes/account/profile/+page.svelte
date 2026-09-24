<script lang="ts">
  /*
   * Account · Profile — the member's identity within Magna Carta.
   *
   * THE NAME IS LIVE. It is read from and written to the account's own record: five parts, and the
   * one line they read as.
   *
   * THE PICTURE IS LIVE TOO, and lives on its own plate
   * ($lib/account/components/member-photo-plate.svelte): the bytes go to the firm's bucket and the
   * row to the firm's roster, which is where a colleague reads it from.
   *
   * THE EMAIL ADDRESS IS STATED AND NOT EDITED, which is a decision rather than an unfinished seam,
   * and it is worth reading before somebody 'finishes' it. The address is the account's SIGN-IN
   * IDENTITY and the key the joining surface resolves a person by: a pending registration, an
   * invitation, and the firm-provision message that makes somebody a member are all addressed to it
   * (apps/api-worker/src/http/routes/session/me.ts reads the joining state from the address, and
   * routes/invitations.ts matches on it). Changing it is therefore not one field write — it is a
   * proof of the new mailbox, a decision about what happens to anything still addressed to the old
   * one, and a moment where the person cannot sign in with either. None of that is hard; all of it
   * has to be designed, and until it is, a disabled box beside a Soon badge would be claiming the
   * work is nearly done. The address is shown because a member needs to know which one their
   * account is, which is the question they actually come here with.
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
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { renderPersonName, splitNameForReview } from "@magna-carta/directory/person-name";
  import { createQuery } from "@tanstack/svelte-query";
  import { meGetOptions } from "@magna-carta/api-client";
  import { SESSION_STABLE } from "$lib/api/screen-data.ts";
  import type { Failure } from "$lib/api/request.ts";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import MemberPhotoPlate from "$lib/account/components/member-photo-plate.svelte";
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
  //
  // NONE OF THEM STATES A DESCRIPTOR (owner correction, 2026-09-18). "Prefix" and "Last Name" say
  // what they are, and a muted line under each explaining that your last name is your family name
  // is the small text that made this surface read as a manual. Where a row genuinely needs to be
  // told something — the ordering of the prefix line, say — the place for it is the control, not a
  // sentence every reader passes over forever. See SettingDefinition.description.
  function nameField(part: string, label: string): SettingDefinition {
    return {
      id: `account.profile.name.${part}`,
      sectionId: "account-profile",
      label,
      kind: "text",
      defaultValue: "",
      sensitivity: "open",
    };
  }

  const PREFIX_DEFINITION = nameField("prefix", "Prefix");
  const FIRST_NAME_DEFINITION = nameField("first", "First Name");
  const MIDDLE_NAME_DEFINITION = nameField("middle", "Middle Name");
  const LAST_NAME_DEFINITION = nameField("last", "Last Name");
  const SUFFIX_DEFINITION = nameField("suffix", "Suffix");

  const EMAIL_DEFINITION: SettingDefinition = {
    id: "account.profile.email",
    sectionId: "account-profile",
    label: "Email",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

  /*
   * Who is signed in, for the address and for the initials the picture falls back to.
   *
   * The (app) layout performs this same read on every navigation at the session-stable ceiling, and
   * the account surface renders in the Secure Shell rather than under that layout — so this is a
   * real read here rather than a cache hit, and it is cached at the same ceiling so that moving
   * between account pages does not repeat it.
   */
  const sessionRead = createQuery(() => ({ ...meGetOptions(), staleTime: SESSION_STABLE }));
  const account = $derived(sessionRead.data ?? null);

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
    const outcome = await readMemberName();
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
    const outcome = await writeMemberName({
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

<AccountMasthead title="Profile" />

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

    <MemberPhotoPlate displayName={name?.displayName ?? account?.user.name ?? ""} />

    <SettingsPlate heading="Identity">
      <!-- Engraved, not a disabled box: a dead control reads as broken and invites fiddling, where
           a plainly stated value reads as what it is — a fact this member can see and cannot
           change from here. The reasoning for the cannot is in this file's header. -->
      <SettingsRow
        definition={EMAIL_DEFINITION}
        value={account?.user.email ?? "—"}
      />
    </SettingsPlate>
  </div>
</div>
