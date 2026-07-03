<script lang="ts">
  /*
   * The Ctrl+K command palette — a Dialog hosting the design system's Command (the house
   * pattern: the dialog owns open/close/focus-trap; the palette owns filtering). Providers grow
   * with the app: navigation (shipped destinations) is the launch set; matters/contacts/actions
   * join as their surfaces ship.
   */
  import { goto } from "$app/navigation";
  import * as Command from "@magna-carta/design-system/command";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import { shippedDestinations } from "$lib/navigation/destinations.ts";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const destinations = shippedDestinations();

  function navigateTo(href: string): void {
    open = false;
    void goto(href);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content showClose={false} class="overflow-hidden p-0">
    <Dialog.Title class="sr-only">Command menu</Dialog.Title>
    <Command.Root label="Command menu" class="border-0 bg-transparent">
      <Command.Input placeholder="Search or jump to anything…" />
      <Command.List>
        <Command.Viewport>
          <Command.Empty>No results found.</Command.Empty>
          <Command.Group>
            <Command.GroupHeading>Go to</Command.GroupHeading>
            <Command.GroupItems>
              {#each destinations as destination (destination.id)}
                <Command.Item onSelect={() => navigateTo(destination.href)}>
                  {destination.label}
                </Command.Item>
              {/each}
              <Command.Item onSelect={() => navigateTo("/settings/appearance")}>
                Settings: appearance
              </Command.Item>
            </Command.GroupItems>
          </Command.Group>
        </Command.Viewport>
      </Command.List>
    </Command.Root>
  </Dialog.Content>
</Dialog.Root>
