<script lang="ts">
  /*
   * The profile menu — the top bar's account corner. The same MC avatar the shell rendered bare
   * becomes the trigger for a dropdown; the panel itself is a standard overlay surface, not
   * chrome. Every seam stays a seam (the shell never fakes function): the identity header still
   * arrives with the signed-in profile and renders honestly inert until then, and an ecosystem
   * site without a live URL renders disabled with a "Soon" badge — a dead link is impossible by
   * construction. Sign out is no longer among them: it ends the real session
   * ($lib/auth/sign-out.ts), which is why it is the one item here that can refuse and say so.
   *
   * The Websites submenu renders from the ecosystem-site registry
   * (src/lib/navigation/ecosystem-sites.ts) — add or wire a site THERE, never here.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import Badge from "@magna-carta/design-system/badge";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Bug from "@lucide/svelte/icons/bug";
  import Earth from "@lucide/svelte/icons/earth";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LifeBuoy from "@lucide/svelte/icons/life-buoy";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Shield from "@lucide/svelte/icons/shield";
  import { goto } from "$app/navigation";
  import { toast } from "@magna-carta/design-system/toast";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";
  import BugReportDialog from "$lib/components/bug-report-dialog.svelte";
  import { signOut } from "$lib/auth/sign-out.ts";

  // The menu owns the bug-report dialog's open state: selecting the item closes the menu, then
  // the dialog takes over focus. The dialog renders as a sibling of the menu, never inside it.
  let bugReportOpen = $state(false);

  // Selecting an item closes the menu, so the guard is not about a second click on a disabled
  // control — it is about the keyboard and the pointer both landing on Sign out, which would spend
  // two sign-out requests and leave the second one refusing a session the first already ended.
  let signingOut = false;

  async function endSession(): Promise<void> {
    if (signingOut) return;
    signingOut = true;
    const outcome = await signOut();
    signingOut = false;
    // Nothing to report on success: the document is already being replaced by the sign-in screen.
    // A refusal has to be said out loud here, because the surface it happened on does not change.
    if (outcome.kind === "failed") toast.error(outcome.message);
  }

  function openEcosystemSite(href: string): void {
    // The design-system menu Item keeps Bits' element delegation closed, so a live site cannot
    // render as a literal anchor; it opens programmatically through the one gate, with the same
    // isolation an anchor through it would get.
    openBeside(href, "external");
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
    <!-- Identity header — still an honest seam, and its sentence has been corrected rather than
         left to rot: it used to say the identity arrived "with accounts", which stopped being true
         the day accounts shipped. The name and firm exist and are already read on every navigation
         (the (app) layout's bootstrap call), so what is missing is only the plumbing from that load
         down to here — not a capability. It says that, and nothing more flattering. -->
    <div class="px-8 py-4">
      <p class="text-sm font-medium">Magna Carta</p>
      <p class="text-xs text-text-muted">Your name and firm are not shown here yet</p>
    </div>
    <DropdownMenu.Separator />
    <!-- Account Settings — the member's own identity and credentials surface, a higher-ceremony
         surface than preference settings: step-up re-authentication lands there when it is built,
         so it hangs off the profile, not the settings nav. Active Sessions inside it is live; the
         password and two-factor rows are still honest Soon seams. The second line names the live
         section rather than only the pending ones. (Shield, not ShieldCheck — the check variant
         is the Trust Center website's icon.) -->
    <DropdownMenu.Item onSelect={() => goto("/account")}>
      <Shield class="size-16" aria-hidden="true" />
      <span class="flex min-w-0 flex-col">
        <span>Account Settings</span>
        <span class="text-xs">Signed-in devices, 2FA, password</span>
      </span>
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
    <!-- Ends the session for real. No confirmation step: signing out costs nothing to undo, and a
         dialog between a person and the door is what makes them leave the tab open instead. -->
    <DropdownMenu.Item onSelect={() => void endSession()}>
      <LogOut class="size-16" aria-hidden="true" />
      Sign out
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<BugReportDialog bind:open={bugReportOpen} />
