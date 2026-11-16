<script lang="ts">
  /*
   * The About window: what this copy of Magna Carta is, and where to go from it. It opens from the
   * profile menu's Websites > About Magna Carta and from the command palette, standing in for the
   * public site until that has an address (src/lib/navigation/ecosystem-sites.ts).
   *
   * IT DESCRIBES THIS COPY, NOT THE PRODUCT (owner's selection, 2026-11-09). Somebody signed in
   * already knows what Magna Carta is; what they come here for is the version, who and where they
   * are signed in, and the way to the changelog, the full version report, help and the legal
   * pages. So the window carries facts and links and no prose about the product.
   *
   * TWO COLUMNS: the brand and the facts on the chrome-register ink column, where the identity
   * lives elsewhere in the shell, and the links on the light column. Copy Version Details puts the
   * facts on the clipboard as plain lines, for a bug report or a message to support.
   *
   * A link whose destination does not exist yet renders muted with a "Soon" badge, the profile
   * menu's own voice for an unwired site, so a dead link is impossible here as it is there.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import BrandMark from "@magna-carta/design-system/brand-mark";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { copyText } from "@magna-carta/design-system/failure-details";
  import { createQuery } from "@tanstack/svelte-query";
  import { meGetOptions } from "@magna-carta/api-client";
  import Check from "@lucide/svelte/icons/check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { goto } from "$app/navigation";
  import { SESSION_STABLE } from "$lib/api/screen-data.ts";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import { issueReport } from "$lib/components/issue-report.svelte.ts";
  import { ECOSYSTEM_SITES } from "$lib/navigation/ecosystem-sites.ts";
  import { openBeside, opensBeside } from "$lib/navigation/open-beside.ts";
  import { aboutDetailsText, aboutFacts } from "./about-facts.ts";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  // The session the (app) layout has already read at the session-stable ceiling: a cache hit, so
  // opening the window costs no request.
  const sessionRead = createQuery(() => ({ ...meGetOptions(), staleTime: SESSION_STABLE }));
  const memberName = $derived.by(() => {
    const user = sessionRead.data?.user;
    if (user === undefined) return null;
    const name = user.name.trim();
    return name === "" ? user.email : name;
  });
  const firmName = $derived(sessionRead.data?.firm?.name ?? null);

  const facts = $derived(
    aboutFacts({
      commit: BUILD_IDENTITY.commit,
      releasedAt: BUILD_IDENTITY.committedAt ?? BUILD_IDENTITY.builtAt,
      mode: BUILD_IDENTITY.mode,
      memberName,
      firmName,
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
    }),
  );
  const commitHref =
    BUILD_IDENTITY.sourceRepository === null
      ? null
      : `${BUILD_IDENTITY.sourceRepository}/commit/${BUILD_IDENTITY.commit}`;

  type AboutLink =
    | { label: string; kind: "route"; route: string }
    | { label: string; kind: "external"; href: string }
    | { label: string; kind: "action"; run: () => void }
    | { label: string; kind: "soon" };

  /* A registry site becomes a link the same way the profile menu renders it. */
  function siteLink(id: string, label: string): AboutLink {
    const site = ECOSYSTEM_SITES.find((candidate) => candidate.id === id);
    if (site?.href) return { label, kind: "external", href: site.href };
    return { label, kind: "soon" };
  }

  const LINK_GROUPS: readonly { heading: string; links: readonly AboutLink[] }[] = [
    {
      heading: "What's new",
      links: [
        siteLink("changelog", "Changelog"),
        { label: "System Status", kind: "route", route: "/settings/system-status" },
      ],
    },
    {
      heading: "Help",
      links: [
        siteLink("status", "Service status"),
        { label: "Report an issue", kind: "action", run: () => issueReport.open() },
        siteLink("documentation", "Documentation"),
      ],
    },
    {
      // No terms, privacy or licence notice is written yet; each lights up here when it is.
      heading: "Legal",
      links: [
        { label: "Terms of Service", kind: "soon" },
        { label: "Privacy Policy", kind: "soon" },
        { label: "Open-source licenses", kind: "soon" },
      ],
    },
  ];

  function follow(link: AboutLink): void {
    if (link.kind === "soon") return;
    if (link.kind === "external") {
      openBeside(link.href, "external");
      return;
    }
    // Leaving for another screen or another dialog closes this one first, so the two never stack.
    open = false;
    if (link.kind === "route") void goto(link.route);
    else link.run();
  }

  let panel = $state<HTMLElement | null>(null);

  let copied = $state<"copied" | "failed" | null>(null);
  async function copyDetails(): Promise<void> {
    copied = await copyText(aboutDetailsText(facts));
    setTimeout(() => (copied = null), copied === "copied" ? 2000 : 6000);
  }
</script>

<Dialog.Root bind:open>
  <!-- Focus starts on the panel itself rather than on the version link, which would otherwise open
       outlined as though the reader had tabbed to it; Tab from there reaches the link as usual. -->
  <Dialog.Content
    bind:ref={panel}
    tabindex={-1}
    class="max-w-2xl p-0 outline-none"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      panel?.focus();
    }}
  >
    <Dialog.Title class="sr-only">About Magna Carta</Dialog.Title>
    <div class="grid grid-cols-1 sm:grid-cols-2">
      <div class="flex flex-col gap-24 bg-chrome-surface p-24 max-sm:rounded-t-lg sm:rounded-s-lg">
        <BrandMark />
        <dl class="flex flex-col gap-12 text-sm">
          {#each facts as fact (fact.term)}
            <div>
              <dt class="text-xs text-chrome-text">{fact.term}</dt>
              <dd class="text-chrome-text-strong">
                {#if fact.term === "Version"}
                  {#if commitHref === null}
                    <span class="font-mono">{fact.value}</span>
                  {:else}
                    <a class="font-mono underline" href={commitHref} {...opensBeside("external")}
                      >{fact.value}</a
                    >
                  {/if}
                {:else}
                  {fact.value}
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
        <Button variant="secondary" class="mt-auto self-start" onclick={() => void copyDetails()}>
          {#if copied === "copied"}
            <Check class="size-16" aria-hidden="true" />
            Copied
          {:else}
            <Copy class="size-16" aria-hidden="true" />
            {copied === "failed" ? "Copy failed, try again" : "Copy version details"}
          {/if}
        </Button>
      </div>
      <nav aria-label="About Magna Carta" class="flex flex-col gap-16 p-24 sm:pt-48">
        {#each LINK_GROUPS as group (group.heading)}
          <section class="flex flex-col gap-4">
            <FieldLabel as="h3">{group.heading}</FieldLabel>
            <ul class="-mx-16 flex flex-col text-sm">
              {#each group.links as link (link.label)}
                <li>
                  {#if link.kind === "soon"}
                    <span class="flex items-center justify-between gap-8 px-16 py-4 text-text-muted">
                      {link.label}
                      <Badge variant="neutral">Soon</Badge>
                    </span>
                  {:else}
                    <Button
                      variant="ghost"
                      class="w-full justify-between"
                      onclick={() => follow(link)}
                    >
                      {link.label}
                      {#if link.kind === "external"}
                        <ExternalLink class="size-16 text-text-muted" aria-hidden="true" />
                      {:else}
                        <ChevronRight class="size-16 text-text-muted" aria-hidden="true" />
                      {/if}
                    </Button>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </nav>
    </div>
  </Dialog.Content>
</Dialog.Root>
