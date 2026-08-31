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
  import Trash2 from "@lucide/svelte/icons/trash-2";
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

  const fileCount = $derived(source.files.length);
</script>

<svelte:head><title>File Workbench · Magna Carta</title></svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <Masthead.Root>
    <Masthead.Heading>
      <Masthead.Title>File Workbench</Masthead.Title>
      <Masthead.Meta>
        <span>Runs outside any matter</span>
        <Masthead.MetaSeparator />
        <span>Nothing is filed</span>
        <Masthead.MetaSeparator />
        <span>Nothing leaves this browser</span>
        {#if fileCount > 0}
          <Masthead.MetaSeparator />
          <span class="tabular-nums">{fileCount} {fileCount === 1 ? "file" : "files"}</span>
        {/if}
      </Masthead.Meta>
    </Masthead.Heading>
    <Masthead.Actions>
      {#if fileCount > 0}
        <Button variant="destructive" size="sm" onclick={() => source.discardAll()}>
          <Trash2 class="size-16" aria-hidden="true" />
          Discard All
        </Button>
      {/if}
    </Masthead.Actions>
  </Masthead.Root>

  <Workbench {source} {permissions} bind:capabilityId />
</div>
