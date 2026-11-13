<script lang="ts">
  /*
   * One line above the shell when the trouble is the platform rather than this panel.
   *
   * It says the true thing ONCE. Without it, several failing reads produce several differently
   * worded local failures on one screen and no statement that anything wider is wrong — which is
   * exactly what a member sees during an incident, and exactly the moment they most need telling.
   *
   * It never replaces the panels' own failures. Those still name what could not be read and still
   * carry the Error ID a report needs; what this adds is the sentence none of them can say, because
   * none of them can see the others.
   */
  import Button from "@magna-carta/design-system/button";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import * as Alert from "@magna-carta/design-system/alert";
  import { platformHealth } from "./platform-health.svelte.ts";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";

  const trouble = $derived(platformHealth.trouble);
  const statusHref = $derived(ECOSYSTEM_SITES.find((site) => site.id === "status")?.href ?? null);
</script>

{#if trouble !== null}
  <!-- No inset of its own: the shell's canvas is already padded, and adding to it would set the
       notice in from the content it sits above. Only the gap below it belongs here. -->
  <div class="pb-16">
    <Alert.Root variant="warning">
      <Alert.Title>
        {trouble === "skew" ? "Magna Carta is mid-update" : "Several reads are failing"}
      </Alert.Title>
      <Alert.Description>
        {#if trouble === "skew"}
          This page is out of date after an update. Reload it. Your saved work isn't affected.
        {:else}
          Parts of this screen couldn't load. Your saved work isn't affected.
        {/if}
      </Alert.Description>
      <div class="flex flex-wrap items-center gap-8 pt-4">
        {#if trouble === "skew"}
          <Button variant="secondary" size="sm" onclick={() => location.reload()}>Reload</Button>
        {/if}
        <!-- The status site is the one ecosystem entry already wired; if it is ever unwired again
             the link disappears rather than becoming a dead control. -->
        {#if statusHref !== null}
          <Button
            variant="secondary"
            size="sm"
            href={statusHref}
            {...opensBeside("external")}
          >
            Service status
          </Button>
        {/if}
      </div>
    </Alert.Root>
  </div>
{/if}
