<script lang="ts">
  /*
   * A bank's own logo, small, beside its name: the picture the bank feed sends, or the name's
   * initials where it sends none. Decorative, because the name always stands beside it.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import { personInitials } from "@magna-carta/design-system/formatters";
  import { bankLogoSource } from "./banking-model.ts";

  let { name, logo }: { name: string; logo: string | null } = $props();

  const source = $derived(bankLogoSource(logo));
</script>

<Avatar.Root class="size-20 shrink-0 rounded-sm" aria-hidden="true">
  {#if source !== null}
    <Avatar.Image src={source} alt="" class="size-full rounded-sm" />
  {/if}
  <Avatar.Fallback class="text-xs">{personInitials(name)}</Avatar.Fallback>
</Avatar.Root>
