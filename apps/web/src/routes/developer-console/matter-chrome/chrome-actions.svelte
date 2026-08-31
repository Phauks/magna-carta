<script lang="ts">
  /*
   * The matter's action cluster, as every candidate carries it: one overflow control holding the
   * status's single lifecycle action, disabled and marked Soon until the wired matters surface
   * makes it live. It is here so the arrangements differ in where the cluster SITS and never in
   * what it holds.
   */
  import Badge from "@magna-carta/design-system/badge";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Archive from "@lucide/svelte/icons/archive";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";

  let { matter }: { matter: MatterRecord } = $props();

  const LIFECYCLE_ACTION: Record<
    MatterRecord["status"],
    { label: string; icon: typeof Archive }
  > = {
    prospective: { label: "Open matter", icon: FolderOpen },
    open: { label: "Close matter", icon: Archive },
    closed: { label: "Reopen", icon: RotateCcw },
  };

  const lifecycle = $derived(LIFECYCLE_ACTION[matter.status]);
  const LifecycleIcon = $derived(lifecycle.icon);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="{buttonClasses({ variant: 'ghost', size: 'icon' })} border border-border-default"
    aria-label="Matter actions"
  >
    <Ellipsis class="size-16" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
    <DropdownMenu.Item disabled>
      <LifecycleIcon class="size-16" aria-hidden="true" />
      {lifecycle.label}
      <Badge variant="neutral" class="ms-auto">Soon</Badge>
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
