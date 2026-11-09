<script lang="ts">
  /*
   * The profile menu — the top bar's account corner. The member's own avatar becomes the trigger
   * for a dropdown; the panel itself is a standard overlay surface, not chrome.
   *
   * IT OPENS ON A PRESS, NEVER ON A POINTER PASSING OVER IT (owner correction, 2026-09-18). Hover
   * activation is right for a menu a member reads by pointing at it — the matter's section strip,
   * the rail's groups — and wrong for the last control in the bar: the account corner sits where a
   * pointer lands on its way to the window's own chrome, and a menu that opens there opens over
   * whatever the member was actually reaching for. So this one menu asks for the press.
   *
   * WHO IS SIGNED IN IS READ, NOT SAID TO BE COMING. The name and the firm come from the session
   * bootstrap the (app) layout already performs on every navigation, through the shared cache at
   * the session-stable ceiling — so opening this menu costs no request. While that read is in
   * flight the same two lines render as a LoadingRegion fixture. An account whose holder has never
   * set a name is named by its address instead. A read that did not answer leaves the header out
   * altogether rather than standing there explaining our own plumbing, which is a sentence no
   * member has ever needed.
   *
   * Every other seam stays a seam (the shell never fakes function): an ecosystem site without a
   * live URL renders disabled with a "Soon" badge, so a dead link is impossible by construction —
   * unless the application already renders that site's content itself (the Changelog), in which
   * case the entry opens that screen until the site has an address.
   * Sign out is not among them: it ends the real session ($lib/auth/sign-out.ts), which is why it
   * is the one item here that can refuse and say so.
   *
   * The Websites submenu renders from the ecosystem-site registry
   * (src/lib/navigation/ecosystem-sites.ts) — add or wire a site THERE, never here.
   */
  import * as Avatar from "@magna-carta/design-system/avatar";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import Badge from "@magna-carta/design-system/badge";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleOrganization, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import { createQuery } from "@tanstack/svelte-query";
  import { meGetOptions } from "@magna-carta/api-client";
  import { SESSION_STABLE } from "$lib/api/screen-data.ts";
  import { personInitials } from "@magna-carta/design-system/formatters";
  import Bug from "@lucide/svelte/icons/bug";
  import Earth from "@lucide/svelte/icons/earth";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LifeBuoy from "@lucide/svelte/icons/life-buoy";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Shield from "@lucide/svelte/icons/shield";
  import { goto } from "$app/navigation";
  import { toast } from "@magna-carta/design-system/toast";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";
  import { issueReport } from "$lib/components/issue-report.svelte.ts";
  import { signOut } from "$lib/auth/sign-out.ts";

  /*
   * Who is signed in. The (app) layout awaits this very read before the shell renders and on every
   * navigation after it, at the session-stable ceiling — so this subscribes to an answer that is
   * already in the cache rather than asking the server for it again.
   */
  const sessionRead = createQuery(() => ({ ...meGetOptions(), staleTime: SESSION_STABLE }));
  const session = $derived(sessionRead.data ?? null);
  /* An account whose holder has never set a name is still an account, and its address names it. */
  const memberName = $derived.by(() => {
    if (session === null) return null;
    const name = session.user.name.trim();
    return name === "" ? session.user.email : name;
  });
  const firmName = $derived(session?.firm?.name ?? null);
  const initials = $derived(memberName === null ? "" : personInitials(memberName));

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

<DropdownMenu.Root openOnHover={false}>
  <!-- The top bar's quiet icon affordance supplies the chrome hover/focus treatment; rounded-full
       + a thin pad keep the halo concentric with the circular avatar. The initials are the member's
       own: a fixed pair of letters on every account is the product's monogram, not a person's. -->
  <DropdownMenu.Trigger class="mc-top-bar-icon-button rounded-full p-4" aria-label="Account menu">
    <Avatar.Root>
      <Avatar.Fallback>{initials}</Avatar.Fallback>
    </Avatar.Root>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
    <!-- Identity header — the member's name over the firm's. A read still in flight shows the same
         two lines as a fixture; a read that did not answer leaves the header and its rule out
         entirely, because a header standing there explaining itself is worse than no header. -->
    {#if sessionRead.isPending || memberName !== null}
      <div class="px-8 py-4">
        <LoadingRegion loading={sessionRead.isPending} label="Reading your account">
          {#snippet fixture()}
            <p class="text-sm font-medium">{samplePerson(0).name}</p>
            <p class="text-xs text-text-muted">{sampleOrganization(1).name}</p>
          {/snippet}
          <p class="text-sm font-medium">{memberName}</p>
          {#if firmName !== null}
            <p class="text-xs text-text-muted">{firmName}</p>
          {/if}
        </LoadingRegion>
      </div>
      <DropdownMenu.Separator />
    {/if}
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
          {@const route = site.route}
          {#if href === null && route !== undefined}
            <!-- The site is not public yet, but the application renders its content itself: an
                 ordinary in-app destination, so no outbound mark. -->
            <DropdownMenu.Item onSelect={() => goto(route)}>
              <SiteIcon class="size-16" aria-hidden="true" />
              {site.label}
            </DropdownMenu.Item>
          {:else if href === null}
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
    <DropdownMenu.Item onSelect={() => issueReport.open()}>
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
