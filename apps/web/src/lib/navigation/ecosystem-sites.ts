/*
 * The ecosystem-site registry — the one home for Magna Carta's associated websites (the status
 * page, forums, the public magna-carta.com site, API documentation, the public changelog). These
 * are SIDE sites, deliberately outside the destination registry (destinations.ts): they leave the
 * app, so they live behind the profile menu (src/lib/components/profile-menu.svelte), never in
 * the sidebar.
 *
 * `href` is the light-up switch: null means the site is not wired yet — the profile menu renders
 * the entry disabled with a "Soon" badge, so a dead link is impossible. When a site goes live,
 * set its href here in the same commit; the menu lights it up as a real external link. Live
 * entries should then ALSO surface in the command palette as a provider group
 * (src/lib/components/command-palette.svelte) — extend the palette from THIS registry when the
 * first site ships; never hand-list a site there.
 *
 * `route` is the in-application stand-in. A site whose content the application already renders for
 * itself names that screen here, and while its `href` is still null the menu and the palette take
 * the member there instead of showing a disabled "Soon" — the content is real, only its public
 * address is not. Once the site goes live, `href` wins and the entry leaves the app as every other
 * site does.
 */
import type { Component } from "svelte";
import Activity from "@lucide/svelte/icons/activity";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import Globe from "@lucide/svelte/icons/globe";
import BookOpen from "@lucide/svelte/icons/book-open";
import CodeXml from "@lucide/svelte/icons/code-xml";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import { aboutWindow } from "$lib/about/about-window.svelte.ts";

export interface EcosystemSite {
  readonly id: string;
  /** User-facing label (sentence case, the vocabulary users recognize). */
  readonly label: string;
  /** One-line purpose — surfaced when live entries reach the command palette. */
  readonly description?: string;
  /** Absolute URL once the site is live; null until wired (renders disabled, marked "Soon"). */
  readonly href: string | null;
  /**
   * An in-application screen that already renders this site's content, used while `href` is null.
   * Absent for a site the application has no copy of.
   */
  readonly route?: string;
  /**
   * An in-application window that stands in for this site while `href` is null, opened by calling
   * it. Absent for a site the application has no window for.
   */
  readonly opensWindow?: () => void;
  readonly icon: Component;
}

export const ECOSYSTEM_SITES: readonly EcosystemSite[] = [
  {
    id: "status",
    label: "Status",
    description: "Live service health and incident history",
    // The first ecosystem site to light up: the status worker's page at the owner's
    // status.magnacarta.esq custom domain (goes live with the same push wave that deploys the
    // status worker and attaches the domain).
    href: "https://status.magnacarta.esq",
    icon: Activity,
  },
  {
    id: "forums",
    label: "Forums",
    description: "Community discussion and answers",
    href: null,
    icon: MessagesSquare,
  },
  {
    id: "about",
    label: "About Magna Carta",
    description: "The public magna-carta.com site",
    // The public site is not deployed yet; the About window states this copy's version and links
    // to the changelog, help and the legal pages in the meantime.
    href: null,
    opensWindow: () => aboutWindow.open(),
    icon: Globe,
  },
  {
    id: "documentation",
    label: "Documentation",
    description: "Product guides and how-to help for using Magna Carta",
    href: null,
    icon: BookOpen,
  },
  {
    id: "api-documentation",
    label: "API documentation",
    description: "Reference for the public API",
    href: null,
    icon: CodeXml,
  },
  {
    id: "changelog",
    label: "Changelog",
    description: "What shipped, release by release",
    // The public changelog page at magnacarta.esq/changelog is not deployed yet; the application's
    // own Changelog screen renders the same document, built into the bundle, in the meantime.
    href: null,
    route: "/updates",
    icon: ScrollText,
  },
  {
    id: "trust-center",
    label: "Trust Center",
    description: "Security, compliance, and data-handling commitments",
    href: null,
    icon: ShieldCheck,
  },
];
