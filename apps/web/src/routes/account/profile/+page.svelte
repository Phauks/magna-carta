<script lang="ts">
  /*
   * Account · Profile — the member's identity within Magna Carta. Every row is an honest Soon
   * seam: profile identity is a person-scoped credential surface, and none of it can function
   * before authentication ships a member profile. Each row swaps its seam for a live control
   * when that arrives; until then the disabled control + Soon badge states the coming choice
   * without faking a value. The seam device (disabled control + Soon) is the same one the
   * settings Text and Beta Access pages use.
   *
   * A NAME IS PARTS, NOT A STRING. This surface asks for the parts a person's name actually has —
   * first, middle, last, with the prefix and suffix beside them — rather than one "Name" box, and
   * that is a decision about the record rather than about this form. The platform already models a
   * person that way everywhere else it names one: a Directory person is prefix / given / middle /
   * family / suffix with a rendered display name over it (packages/directory/src/person.ts), and a
   * member's own name is the one the firm's letterhead, pleading signature blocks and generated
   * documents print. A single string cannot be sorted by surname, cannot address a letter, and
   * cannot be split back into parts afterwards without guessing — "Mary Anne van der Berg III" has
   * no rule that recovers it. So the parts are what is collected, and the display name is rendered
   * FROM them rather than typed beside them.
   *
   * The store behind this does not exist yet: the control-plane user row carries one `name`, and
   * the per-firm member row mirrors it as `display_name` (packages/database/src/per-firm-schema.ts).
   * Both grow the parts when the authentication surface lands, which is the same moment these rows
   * stop being seams.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import AccountMasthead from "$lib/account/components/account-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsRow from "$lib/settings/components/settings-row.svelte";
  import HonorificField from "$lib/names/honorific-field.svelte";
  import type { SettingDefinition } from "$lib/settings/settings-definitions.ts";

  // Page-local seam definitions: rendering through SettingsRow keeps the shared table grid. The
  // kind/defaultValue fields are inert here (the control snippet renders instead), set to honest
  // neutral values.
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

  // The five parts, in the order a name is read. Prefix and suffix are optional in practice and
  // still their own rows: a suffix is part of a person's legal name and belongs on a pleading, and
  // folding either into an adjacent box is how they end up inside a surname.
  //
  // Those two take the honorific control rather than a box, the same one the Directory's person
  // forms take, so the seam shows the shape that is coming rather than a shape it will not have.
  const PREFIX_DEFINITION = nameField(
    "prefix",
    "Prefix",
    "How you are addressed — Ms., Dr., Hon. Optional.",
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
    "What follows your name — Jr., III, Esq. Optional.",
  );

  const DISPLAY_NAME_DEFINITION: SettingDefinition = {
    id: "account.profile.display-name",
    sectionId: "account-profile",
    label: "Display Name",
    description: "The name shown across Magna Carta, composed from the parts above.",
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };

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

  const TYPED_NAME_PARTS: readonly SettingDefinition[] = [
    FIRST_NAME_DEFINITION,
    MIDDLE_NAME_DEFINITION,
    LAST_NAME_DEFINITION,
  ];

  // Nothing is stored yet, so the honorific controls have nowhere to write; the bindings are local
  // and inert, which is what the disabled state and the Soon badge already say.
  let prefix = $state("");
  let suffix = $state("");
</script>

<svelte:head>
  <title>Profile · Account · Magna Carta</title>
</svelte:head>

<AccountMasthead title="Profile" meta="Your identity within Magna Carta." />

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    <SettingsPlate heading="Name">
      <SettingsRow definition={PREFIX_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <HonorificField part="prefix" bind:value={prefix} disabled />
        {/snippet}
      </SettingsRow>

      {#each TYPED_NAME_PARTS as definition (definition.id)}
        <SettingsRow {definition}>
          {#snippet control()}
            <Badge variant="neutral">Soon</Badge>
            <Input
              disabled
              placeholder="—"
              aria-label="{definition.label} (arrives with authentication)"
            />
          {/snippet}
        </SettingsRow>
      {/each}

      <SettingsRow definition={SUFFIX_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <HonorificField part="suffix" bind:value={suffix} disabled />
        {/snippet}
      </SettingsRow>

      <SettingsRow definition={DISPLAY_NAME_DEFINITION}>
        {#snippet control()}
          <Badge variant="neutral">Soon</Badge>
          <!-- Composed, never typed: a display name a member can edit apart from the parts is a
               second answer to what they are called, and the two disagree the first time one of
               them is corrected. -->
          <Input disabled placeholder="—" aria-label="Display name (composed from the name parts)" />
        {/snippet}
      </SettingsRow>
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
