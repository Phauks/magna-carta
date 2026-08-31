<script lang="ts">
  /*
   * File Workbench — where a file that belongs to no matter is brought to be read.
   *
   * Every file utility the firm has asks for the same bytes. Rather than ten screens each demanding
   * their own upload, a file is brought here once and every capability addresses it: what it is,
   * what it hashes to, what its metadata holds, what it converts to, whether it is safe. The
   * question a person actually arrives with is "I have a file, what can I do with it", and that is
   * one screen, not ten.
   *
   * ETHEREAL BY DESIGN. Nothing here is filed, and nothing here has a history. Keeping a record of
   * inspections would mean retaining information about files the firm never filed, which is exactly
   * what this area must not do. The same body serves a matter's files, where a history IS legitimate
   * because it hangs off a record that already exists; that host wires those capabilities in and
   * this one does not.
   *
   * The capabilities themselves are the registry in $lib/tools/file-workbench/capabilities.ts.
   * Adding one is a module and a line in that array.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Workbench from "$lib/tools/file-workbench/workbench.svelte";
  import { EphemeralFileSource } from "$lib/tools/file-workbench/ephemeral-source.svelte.ts";
  import { capabilityById } from "$lib/tools/file-workbench/capabilities.ts";
  import { OVERVIEW_CAPABILITY } from "$lib/tools/file-workbench/overview.ts";
  import { grantedPermissions } from "$lib/tools/tool-permissions.ts";

  const source = new EphemeralFileSource();
  const permissions = grantedPermissions();

  // The address can name a capability, which is what lets a tool in the listing open the workbench
  // already on its own reading. It is read once, at load: the tab strip is the control after that.
  let capabilityId = $state(
    capabilityById(page.url.searchParams.get("capability"))?.id ?? OVERVIEW_CAPABILITY,
  );

  /*
   * Whether the file is drawn beside its readings. One control, held across every tab: which
   * capability is open is not a reason to take the page away from somebody who wants to see it, and
   * the width it costs is a judgement only the person reading can make.
   */
  let previewOpen = $state(true);
</script>

<svelte:head><title>File Workbench · Magna Carta</title></svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <Masthead.Root>
    <Masthead.Heading>
      <Masthead.Title>File Workbench</Masthead.Title>
      <!-- The file count is not here. It belongs to the list, and the list's own footer already
           carries it beside the selection, which is where a reader looks for both. -->
      <Masthead.Meta>
        <span>Runs outside any matter</span>
        <Masthead.MetaSeparator />
        <span>Nothing is filed</span>
        <Masthead.MetaSeparator />
        <span>Nothing leaves this browser</span>
      </Masthead.Meta>
    </Masthead.Heading>
    <!-- Adding files and discarding them are the list's verbs and live on the list: the button
         above it, and each row's own menu. What is left up here is the one control that is about
         the whole screen rather than about any file. -->
    <Masthead.Actions>
      <Button
        variant="secondary"
        size="sm"
        aria-pressed={previewOpen}
        title={previewOpen ? "Hide the file and give the readings the width" : "Show the file beside its readings"}
        onclick={() => (previewOpen = !previewOpen)}
      >
        {#if previewOpen}
          <EyeOff class="size-16" aria-hidden="true" />
          Hide Preview
        {:else}
          <Eye class="size-16" aria-hidden="true" />
          Show Preview
        {/if}
      </Button>
    </Masthead.Actions>
  </Masthead.Root>

  <Workbench {source} {permissions} bind:capabilityId {previewOpen} />
</div>
