<script lang="ts">
  /*
   * The profile menu — the top bar's account corner. The same MC avatar the shell rendered bare
   * becomes the trigger for a dropdown; the panel itself is a standard overlay surface, not
   * chrome. Every seam stays a seam (the shell never fakes function): the identity header and
   * Sign out arrive with authentication (the next roadmap stage) and render honestly inert until
   * then, and an ecosystem site without a live URL renders disabled with a "Soon" badge — a dead
   * link is impossible by construction.
   *
   * The Websites submenu renders from the ecosystem-site registry
   * (src/lib/navigation/ecosystem-sites.ts) — add or wire a site THERE, never here.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import Badge from "@magna-carta/design-system/badge";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Bug from "@lucide/svelte/icons/bug";
  import Earth from "@lucide/svelte/icons/earth";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LifeBuoy from "@lucide/svelte/icons/life-buoy";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Shield from "@lucide/svelte/icons/shield";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";
  import BugReportDialog from "$lib/components/bug-report-dialog.svelte";

  // The menu owns the bug-report dialog's open state: selecting the item closes the menu, then
  // the dialog takes over focus. The dialog renders as a sibling of the menu, never inside it.
  let bugReportOpen = $state(false);

  function openEcosystemSite(href: string): void {
    // The design-system menu Item keeps Bits' element delegation closed, so a live site cannot
    // render as a literal anchor; it opens programmatically with the same isolation a
    // target="_blank" rel="noreferrer noopener" link would get.
    window.open(href, "_blank", "noopener,noreferrer");
  }
</script>

<DropdownMenu.Root>
  <!-- The top bar's quiet icon affordance supplies the chrome hover/focus treatment; rounded-full
       + a thin pad keep the halo concentric with the circular avatar. -->
  <DropdownMenu.Trigger class="mc-top-bar-icon-button rounded-full p-4" aria-label="Account menu">
    <Avatar.Root>
      <Avatar.Fallback>MC</Avatar.Fallback>
    </Avatar.Root>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
    <!-- Identity header — an honest seam, not fake data: real name/firm land with accounts. -->
    <div class="px-8 py-4">
      <p class="text-sm font-medium">Magna Carta</p>
      <p class="text-xs text-text-muted">Signed-in identity arrives with accounts</p>
    </div>
    <DropdownMenu.Separator />
    <!-- Account Settings — an honest seam under the identity it will govern (owner directive).
         Credentials and profile identity (2FA, password, resets, profile information) are a
         separate, HIGHER-CEREMONY surface than preference settings: step-up re-authentication
         lives there when authentication ships, so it hangs off the profile, not the settings
         nav. "Account Settings" is the owner's working name — it may be renamed; one string.
         (Shield, not ShieldCheck — the check variant is the Trust Center website's icon.) -->
    <!-- The scope line names WHAT the surface covers; the arrival is the Soon badge's job
         (an "arrives with…" clause beside a Soon badge is redundant — owner-directed). -->
    <DropdownMenu.Item disabled>
      <Shield class="size-16" aria-hidden="true" />
      <span class="flex min-w-0 flex-col">
        <span>Account Settings</span>
        <span class="text-xs">2FA, password, and profile</span>
      </span>
      <Badge variant="neutral" class="ms-auto">Soon</Badge>
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Sub>
      <!-- The profile menu hugs the viewport's right edge, so the submenu must open INWARD
           (left) — and the trigger's chevron points left to match the motion (owner review
           2026-07-02: a right-pointing arrow over a left-opening panel contradicts itself). -->
      <DropdownMenu.SubTrigger submenuSide="left">
        <Earth class="size-16" aria-hidden="true" />
        Websites
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent side="left" style="min-inline-size: var(--mc-size-popover)">
        {#each ECOSYSTEM_SITES as site (site.id)}
          {@const SiteIcon = site.icon}
          {@const href = site.href}
          {#if href === null}
            <DropdownMenu.Item disabled>
              <SiteIcon class="size-16" aria-hidden="true" />
              {site.label}
              <Badge variant="neutral" class="ms-auto">Soon</Badge>
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item onSelect={() => openEcosystemSite(href)}>
              <SiteIcon class="size-16" aria-hidden="true" />
              {site.label}
              <ExternalLink class="ms-auto size-16" aria-hidden="true" />
            </DropdownMenu.Item>
          {/if}
        {/each}
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
    <DropdownMenu.Separator />
    <!-- Help group. "Report an Issue" is live from every screen — the dialog assembles a
         copy-ready report (bug-report-dialog.svelte). "Request assistance" is an honest seam
         for the owner's support funnel: contacting an agent will REQUIRE a filed bug/issue
         report first, so the report id anchors the conversation; the backend support-access
         framework (time-boxed, firm-approved access grants — pull, not push) already exists
         for the support session that follows. The live contact flow lands with in-application
         support. -->
    <DropdownMenu.Item onSelect={() => (bugReportOpen = true)}>
      <Bug class="size-16" aria-hidden="true" />
      Report an Issue
    </DropdownMenu.Item>
    <!-- Single line: its old second line stated only the arrival, which the Soon badge says. -->
    <DropdownMenu.Item disabled>
      <LifeBuoy class="size-16" aria-hidden="true" />
      Request assistance
      <Badge variant="neutral" class="ms-auto">Soon</Badge>
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <!-- Disabled until authentication ships — there is no session to end yet. -->
    <DropdownMenu.Item disabled>
      <LogOut class="size-16" aria-hidden="true" />
      Sign out
      <Badge variant="neutral" class="ms-auto">Soon</Badge>
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<BugReportDialog bind:open={bugReportOpen} />
