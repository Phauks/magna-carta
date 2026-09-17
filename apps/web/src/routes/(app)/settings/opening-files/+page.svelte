<script lang="ts">
  /*
   * Settings · Opening Files — what the one Open gesture does for each kind of file.
   *
   * THE TABLE IS THE REGISTER. The rows render from file-type-register.ts, which is the same object
   * the file manager decides Open from, so what a member reads here is what the product does and
   * neither can drift from the other. Nothing on this page is typed by hand.
   *
   * A ROUTING TABLE, READ-ONLY TODAY. Every family opens one way, so there is nothing to choose;
   * the page states it. The owner's direction is that this is where a second way of opening lands
   * when one exists — a desktop application, another editor — and the shape is chosen for that:
   * one plate per way, each family a row under the way that takes it, so a family that gains a
   * choice grows a control on its row rather than a page of its own.
   *
   * The masthead carries no History trigger: this page has no ledger section — the register is
   * stated, not changed — and an always-empty trail would say something untrue about where a change
   * would be recorded.
   */
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import { familiesOpenedBy, OPEN_METHODS } from "$lib/documents/file-type-register.ts";

  /** ".docx, .xlsx, …" — the reader's own spelling of an extension, with the dot. */
  function spelled(extensions: readonly string[]): string {
    return extensions.map((extension) => `.${extension}`).join(", ");
  }
</script>

<svelte:head>
  <title>Opening Files · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="opening-files"
  title="Opening Files"
  posture="readOnly"
  badgeLabel="Stated by the platform"
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    What opening a file does, by the kind of file it is. Double-click, Enter and Open are one
    gesture; this is where each kind of file goes.
  </SettingsDescription>

  {#each OPEN_METHODS as method (method.id)}
    <SettingsPlate heading={method.label}>
      <SettingsPlateNote>{method.description}</SettingsPlateNote>
      <DefinitionList.Root>
        {#each familiesOpenedBy(method.id) as family (family.id)}
          <DefinitionList.Row term={family.label}>
            <span class="font-mono text-xs">{spelled(family.extensions)}</span>
            {#if family.note !== undefined}
              <span class="mt-4 block text-xs text-text-muted">{family.note}</span>
            {/if}
          </DefinitionList.Row>
        {/each}
      </DefinitionList.Root>
    </SettingsPlate>
  {/each}
</SettingsScrollRegion>
